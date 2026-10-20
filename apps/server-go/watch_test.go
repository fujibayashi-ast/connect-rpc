package main

import (
	"context"
	"testing"

	contactv1 "connect-rpc/server-go/gen/contact/v1"
)

func create(t *testing.T, s *contactServer, name, email string) *contactv1.Contact {
	t.Helper()
	res, err := s.CreateContact(context.Background(), &contactv1.CreateContactRequest{
		Contact: &contactv1.Contact{Name: name, Email: email, Category: contactv1.Category_CATEGORY_GENERAL},
	})
	if err != nil {
		t.Fatalf("CreateContact: %v", err)
	}
	return res.GetContact()
}

func next(t *testing.T, sub *subscriber) *contactv1.ContactChange {
	t.Helper()
	select {
	case change, ok := <-sub.ch:
		if !ok {
			t.Fatal("チャネルが閉じられている")
		}
		return change
	default:
		t.Fatal("変更が届いていない")
		return nil
	}
}

func TestSubscribe_スナップショットのあとに変更が順に届く(t *testing.T) {
	s := &contactServer{}
	existing := create(t, s, "既存", "existing@example.com")

	snapshot, sub := s.subscribe()
	defer s.unsubscribe(sub)

	if len(snapshot) != 1 || snapshot[0].GetId() != existing.GetId() {
		t.Fatalf("snapshot = %v, want [%s]", snapshot, existing.GetId())
	}

	created := create(t, s, "新規", "new@example.com")
	if _, err := s.UpdateContact(context.Background(), &contactv1.UpdateContactRequest{
		Id:      created.GetId(),
		Contact: &contactv1.Contact{Name: "更新後", Email: "new@example.com", Category: contactv1.Category_CATEGORY_SUPPORT},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteContact(context.Background(), &contactv1.DeleteContactRequest{Id: created.GetId()}); err != nil {
		t.Fatal(err)
	}

	want := []struct {
		typ  contactv1.ChangeType
		name string
	}{
		{contactv1.ChangeType_CHANGE_TYPE_CREATED, "新規"},
		{contactv1.ChangeType_CHANGE_TYPE_UPDATED, "更新後"},
		// 削除は、削除する前の Contact が届く
		{contactv1.ChangeType_CHANGE_TYPE_DELETED, "更新後"},
	}
	for i, w := range want {
		got := next(t, sub)
		if got.GetType() != w.typ || got.GetContact().GetName() != w.name || got.GetContact().GetId() != created.GetId() {
			t.Errorf("change %d = %v, want type=%v name=%s", i, got, w.typ, w.name)
		}
	}
}

func TestSubscribe_スナップショットは内部の状態と共有しない(t *testing.T) {
	s := &contactServer{}
	create(t, s, "既存", "existing@example.com")

	snapshot, sub := s.subscribe()
	defer s.unsubscribe(sub)
	snapshot[0].Name = "書き換えた"

	if got := s.contacts[0].GetName(); got != "既存" {
		t.Errorf("内部の状態が書き換わった: %s", got)
	}
}

func TestUnsubscribe_外すと届かず二重に外しても安全(t *testing.T) {
	s := &contactServer{}
	_, sub := s.subscribe()

	s.unsubscribe(sub)
	create(t, s, "A", "a@example.com")

	select {
	case change := <-sub.ch:
		t.Fatalf("外したあとに届いた: %v", change)
	default:
	}
	if len(s.subs) != 0 {
		t.Errorf("購読者が残っている: %d", len(s.subs))
	}
	s.unsubscribe(sub)
}

func TestPublish_遅い購読者は切られほかの購読者には届く(t *testing.T) {
	s := &contactServer{}
	_, slow := s.subscribe()
	_, fast := s.subscribe()

	// バッファを超えるまで、slow は読まない。fast は読み続ける
	for i := 0; i <= subscriberBuffer; i++ {
		create(t, s, "A", string(rune('a'+i%26))+"-"+string(rune('0'+i/26))+"@example.com")
		next(t, fast)
	}

	for i := 0; i < subscriberBuffer; i++ {
		next(t, slow)
	}
	if _, ok := <-slow.ch; ok {
		t.Fatal("遅い購読者のチャネルが閉じられていない")
	}
	if _, ok := s.subs[slow]; ok {
		t.Error("遅い購読者が集合に残っている")
	}
	if _, ok := s.subs[fast]; !ok {
		t.Error("速い購読者まで外された")
	}
	// 閉じられたあとに外しても、パニックしない
	s.unsubscribe(slow)
}
