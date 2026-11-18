package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

// EmailKind identifies a message.
type EmailKind string

const (
	EmailVerification          EmailKind = "verification"
	EmailPasswordReset         EmailKind = "passwordReset"
	EmailAccountExists         EmailKind = "accountExists"
	EmailPasswordChanged       EmailKind = "passwordChanged"
	EmailPasswordResetComplete EmailKind = "passwordResetCompleted"
)

// EmailMessage is a message to deliver.
type EmailMessage struct {
	Kind    EmailKind
	To      string
	Subject string
	Text    string
	// Link is set for messages that carry a link.
	Link string
	// Token is the raw one-time token, for test mailers only. Never log it.
	Token string
}

// Mailer delivers email. Email delivery is an application concern: implement
// Mailer with your provider (SMTP, SES, Resend, ...).
type Mailer interface {
	Send(ctx context.Context, m EmailMessage) error
}

// MemoryMailer keeps messages in memory, for tests and the conformance harness.
type MemoryMailer struct {
	mu   sync.Mutex
	sent []EmailMessage
}

func (m *MemoryMailer) Send(_ context.Context, msg EmailMessage) error {
	m.mu.Lock()
	m.sent = append(m.sent, msg)
	m.mu.Unlock()
	return nil
}

// LastTo returns the latest message to address (case-insensitive), if any.
func (m *MemoryMailer) LastTo(address string) (EmailMessage, bool) {
	target := strings.ToLower(strings.TrimSpace(address))
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.sent) - 1; i >= 0; i-- {
		if strings.ToLower(strings.TrimSpace(m.sent[i].To)) == target {
			return m.sent[i], true
		}
	}
	return EmailMessage{}, false
}

// DevConsoleMailer prints messages (with their one-time links) to stdout so links
// can be clicked locally. It refuses to run in production because one-time links
// must never reach production logs (SEC-LOG-001).
type DevConsoleMailer struct{}

func NewDevConsoleMailer(production bool) (*DevConsoleMailer, error) {
	if production {
		return nil, errors.New("DevConsoleMailer must not be used in production; configure a real Mailer")
	}
	return &DevConsoleMailer{}, nil
}

func (*DevConsoleMailer) Send(_ context.Context, m EmailMessage) error {
	_, err := fmt.Fprintf(os.Stdout, "\n[dev mail] to=%s kind=%s\n%s\n%s\n", m.To, m.Kind, m.Subject, m.Text)
	return err
}
