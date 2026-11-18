// Package email provides the application's mailer.
package email

import (
	"errors"

	"example.com/app/internal/auth"
	"example.com/app/internal/config"
)

// NewMailer returns the mailer for env. Replace the production branch with your
// provider (SMTP, SES, Resend, Postmark, ...) by implementing auth.Mailer. Until
// you do, the server refuses to start in production rather than silently
// dropping verification and password-reset emails.
func NewMailer(env config.Env) (auth.Mailer, error) {
	if env.Production() {
		return nil, errors.New("no email provider configured: implement NewMailer in internal/email/mailer.go before running in production")
	}
	// Development: prints messages (including one-time links) to the console.
	return auth.NewDevConsoleMailer(false)
}
