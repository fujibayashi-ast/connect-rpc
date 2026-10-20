package main

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	contactv1 "connect-rpc/server-go/gen/contact/v1"
)

func TestListContacts_壊れたトークンは_invalid_argument(t *testing.T) {
	s := &contactServer{}
	for _, token := range []string{"abc", "!!!", "KzU", "MA", "LTE", "MWUz"} {
		_, err := s.ListContacts(context.Background(), &contactv1.ListContactsRequest{PageToken: token})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("token %q: code = %v", token, connect.CodeOf(err))
		}
	}
}
