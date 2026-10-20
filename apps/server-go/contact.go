package main

import (
	"context"
	"encoding/base64"
	"strconv"
	"strings"
	"sync"

	validatepb "buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"

	contactv1 "connect-rpc/server-go/gen/contact/v1"
)

// contact.proto のフィールド番号。重複エラーの field path を組み立てるのに使う
const (
	createRequestContactField = 1
	updateRequestContactField = 2
	contactEmailField         = 3
)

// contactServer はインメモリで連絡先を持つ。永続化はしない
type contactServer struct {
	mu       sync.Mutex
	contacts []*contactv1.Contact // 登録順
	// 登録の通し番号。page_token の中身になる。削除しても番号は詰めないので、
	// ページをめくる間に削除や追加があっても、飛んだり重複したりしない
	nextSeq int64
	seqs    map[string]int64 // id -> 通し番号
	subs    map[*subscriber]struct{}
}

func (s *contactServer) CreateContact(ctx context.Context, req *contactv1.CreateContactRequest) (*contactv1.CreateContactResponse, error) {
	// 期限は Connect-Timeout-Ms で届く。切れていれば何もせずに返す
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.emailTaken(req.GetContact().GetEmail(), "") {
		return nil, duplicateEmailError(createRequestContactField)
	}
	c := proto.Clone(req.GetContact()).(*contactv1.Contact)
	c.Id = uuid.NewString()
	s.contacts = append(s.contacts, c)
	if s.seqs == nil {
		s.seqs = map[string]int64{}
	}
	s.nextSeq++
	s.seqs[c.Id] = s.nextSeq
	s.publish(contactv1.ChangeType_CHANGE_TYPE_CREATED, c)
	return &contactv1.CreateContactResponse{Contact: proto.Clone(c).(*contactv1.Contact)}, nil
}

func (s *contactServer) GetContact(ctx context.Context, req *contactv1.GetContactRequest) (*contactv1.GetContactResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	i := s.indexOf(req.GetId())
	if i < 0 {
		return nil, notFoundError(req.GetId())
	}
	return &contactv1.GetContactResponse{Contact: proto.Clone(s.contacts[i]).(*contactv1.Contact)}, nil
}

func (s *contactServer) ListContacts(ctx context.Context, req *contactv1.ListContactsRequest) (*contactv1.ListContactsResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	after, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	size := int(req.GetPageSize())
	if size == 0 {
		size = defaultPageSize
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	resp := &contactv1.ListContactsResponse{}
	for _, c := range s.contacts {
		seq := s.seqs[c.GetId()]
		if seq <= after {
			continue
		}
		if len(resp.Contacts) == size {
			// まだ残りがある。最後に返した連絡先の番号が、次のページの起点になる
			resp.NextPageToken = encodePageToken(s.seqs[resp.Contacts[size-1].GetId()])
			break
		}
		resp.Contacts = append(resp.Contacts, proto.Clone(c).(*contactv1.Contact))
	}
	return resp, nil
}

const defaultPageSize = 50

// page_token は通し番号を base64url にしただけのもの。クライアントには中身を意味のない文字列として扱わせる
func encodePageToken(seq int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(seq, 10)))
}

// 空のトークンは先頭から（0）。壊れたトークンは invalid_argument
func decodePageToken(token string) (int64, error) {
	if token == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err == nil {
		var seq int64
		// 再エンコードして一致するものだけを受け付ける（"+5" のような壊れたトークンを弾く。TS と同じ）
		if seq, err = strconv.ParseInt(string(raw), 10, 64); err == nil && seq > 0 && encodePageToken(seq) == token {
			return seq, nil
		}
	}
	return 0, connect.NewError(connect.CodeInvalidArgument, "invalid page_token")
}

func (s *contactServer) UpdateContact(ctx context.Context, req *contactv1.UpdateContactRequest) (*contactv1.UpdateContactResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	i := s.indexOf(req.GetId())
	if i < 0 {
		return nil, notFoundError(req.GetId())
	}
	// 自分自身の email は重複とみなさない
	if s.emailTaken(req.GetContact().GetEmail(), req.GetId()) {
		return nil, duplicateEmailError(updateRequestContactField)
	}
	c := proto.Clone(req.GetContact()).(*contactv1.Contact)
	c.Id = req.GetId()
	s.contacts[i] = c
	s.publish(contactv1.ChangeType_CHANGE_TYPE_UPDATED, c)
	return &contactv1.UpdateContactResponse{Contact: proto.Clone(c).(*contactv1.Contact)}, nil
}

func (s *contactServer) DeleteContact(ctx context.Context, req *contactv1.DeleteContactRequest) (*contactv1.DeleteContactResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	i := s.indexOf(req.GetId())
	if i < 0 {
		return nil, notFoundError(req.GetId())
	}
	deleted := s.contacts[i]
	s.contacts = append(s.contacts[:i], s.contacts[i+1:]...)
	delete(s.seqs, deleted.GetId())
	s.publish(contactv1.ChangeType_CHANGE_TYPE_DELETED, deleted)
	return &contactv1.DeleteContactResponse{}, nil
}

// indexOf は呼び出し側が mu を握っていること
func (s *contactServer) indexOf(id string) int {
	for i, c := range s.contacts {
		if c.GetId() == id {
			return i
		}
	}
	return -1
}

// emailTaken は大文字小文字を区別せずに比較する。exceptID の連絡先は除く。呼び出し側が mu を握っていること
func (s *contactServer) emailTaken(email, exceptID string) bool {
	for _, c := range s.contacts {
		if c.GetId() != exceptID && strings.EqualFold(c.GetEmail(), email) {
			return true
		}
	}
	return false
}

func notFoundError(id string) error {
	return connect.NewError(connect.CodeNotFound, "contact not found: "+id)
}

// duplicateEmailError は検証エラーと同じ buf.validate.Violations を details に載せる。
// クライアントは検証エラーと同じ処理で email 欄に表示できる
func duplicateEmailError(contactField int32) error {
	const msg = "このメールアドレスは既に登録されています"
	err := connect.NewError(connect.CodeAlreadyExists, msg)

	violations := &validatepb.Violations{
		Violations: []*validatepb.Violation{{
			Field: &validatepb.FieldPath{Elements: []*validatepb.FieldPathElement{
				pathElement("contact", contactField, descriptorpb.FieldDescriptorProto_TYPE_MESSAGE),
				pathElement("email", contactEmailField, descriptorpb.FieldDescriptorProto_TYPE_STRING),
			}},
			RuleId:  proto.String("contact.email_unique"),
			Message: proto.String(msg),
		}},
	}
	detail, derr := connectproto.NewErrorDetail(violations)
	if derr != nil {
		return err
	}
	return err.WithDetail(detail)
}

func pathElement(name string, number int32, typ descriptorpb.FieldDescriptorProto_Type) *validatepb.FieldPathElement {
	return &validatepb.FieldPathElement{
		FieldName:   proto.String(name),
		FieldNumber: proto.Int32(number),
		FieldType:   typ.Enum(),
	}
}
