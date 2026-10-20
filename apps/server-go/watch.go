package main

import (
	"context"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	contactv1 "connect-rpc/server-go/gen/contact/v1"
	"connect-rpc/server-go/gen/contact/v1/contactv1connect"
)

// subscriberBuffer は、購読者ごとに溜めておける変更の数。
// いっぱいになった購読者は切る（変更を発行する側を、遅い購読者のために待たせない）
const subscriberBuffer = 64

type subscriber struct {
	ch chan *contactv1.ContactChange
}

// WatchContacts は、接続した直後に現在の一覧（snapshot）を 1 回送り、その後は変更を送り続ける。
// クライアントが切断・中止すると ctx が終わり、購読を外して返る
func (s *contactServer) WatchContacts(ctx context.Context, _ *contactv1.WatchContactsRequest, stream contactv1connect.ContactServiceWatchContactsServerStream) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	snapshot, sub := s.subscribe()
	defer s.unsubscribe(sub)

	err := stream.Send(&contactv1.WatchContactsResponse{
		Event: &contactv1.WatchContactsResponse_Snapshot{
			Snapshot: &contactv1.ContactSnapshot{Contacts: snapshot},
		},
	})
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case change, ok := <-sub.ch:
			if !ok {
				return connect.NewError(connect.CodeResourceExhausted, "client is too slow")
			}
			err := stream.Send(&contactv1.WatchContactsResponse{
				Event: &contactv1.WatchContactsResponse_Change{Change: change},
			})
			if err != nil {
				return err
			}
		}
	}
}

// subscribe は、現在の一覧と購読者を同じロックの中で作る。
// こうすると、一覧と最初の変更の間に取りこぼしが出ない
func (s *contactServer) subscribe() ([]*contactv1.Contact, *subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()

	snapshot := make([]*contactv1.Contact, len(s.contacts))
	for i, c := range s.contacts {
		snapshot[i] = proto.Clone(c).(*contactv1.Contact)
	}
	sub := &subscriber{ch: make(chan *contactv1.ContactChange, subscriberBuffer)}
	if s.subs == nil {
		s.subs = map[*subscriber]struct{}{}
	}
	s.subs[sub] = struct{}{}
	return snapshot, sub
}

// unsubscribe は、publish がすでに切った購読者に対しても安全
func (s *contactServer) unsubscribe(sub *subscriber) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subs, sub)
}

// publish は変更をすべての購読者に送る。呼び出し側が mu を握っていること
// （変更と発行が同じロックの中にあるので、変更は起きた順に届く）
func (s *contactServer) publish(t contactv1.ChangeType, c *contactv1.Contact) {
	change := &contactv1.ContactChange{Type: t, Contact: proto.Clone(c).(*contactv1.Contact)}
	for sub := range s.subs {
		select {
		case sub.ch <- change:
		default:
			// 遅い購読者は切る。チャネルを閉じると WatchContacts が気づいて終わる
			delete(s.subs, sub)
			close(sub.ch)
		}
	}
}
