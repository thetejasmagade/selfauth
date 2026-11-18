package auth

import (
	"context"
	"errors"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"example.com/app/internal/config"
)

// RequestContext holds per-request facts the service needs; supplied by the transport adapter.
type RequestContext struct {
	IPAddress string
	UserAgent string
	RequestID string
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (c RequestContext) addr() string {
	if c.IPAddress == "" {
		return "null"
	}
	return c.IPAddress
}

// Context is a validated session plus the subject derived from server-side state.
type Context struct {
	Subject
	Session SessionRecord
	User    UserRecord
}

// IssuedSession is a newly created session. Token goes only into the cookie (AUTHN-SESS-001).
type IssuedSession struct {
	Token   string
	Session SessionRecord
}

// PublicUser is the user as exposed over HTTP.
type PublicUser struct {
	ID            string       `json:"id"`
	Email         *string      `json:"email"`
	EmailVerified bool         `json:"emailVerified"`
	State         AccountState `json:"state"`
	Roles         []string     `json:"roles"`
	Permissions   []string     `json:"permissions"`
}

// RegisterResult is either "accepted" (no session) or "signed in".
type RegisterResult struct {
	SignedIn bool
	User     PublicUser
	Issued   IssuedSession
}

// Input is a decoded JSON object body.
type Input map[string]any

type Deps struct {
	Config  *config.Config
	Store   Store
	Mailer  Mailer
	Clock   Clock
	Hasher  *PasswordHasher
	Limiter *RateLimiter
	// AppBaseURL builds email links; never derived from request headers (AUTHN-VERIFY-009).
	AppBaseURL *url.URL
}

var adminTransitions = map[AccountState][]AccountState{
	StatePending:   {StateDisabled, StateDeleted},
	StateActive:    {StateSuspended, StateDisabled, StateDeleted},
	StateSuspended: {StateActive, StateDisabled, StateDeleted},
	StateDisabled:  {StateActive, StateDeleted},
	StateDeleted:   {},
}

var accountStates = []AccountState{StatePending, StateActive, StateSuspended, StateDisabled, StateDeleted}

const minuteMs = 60 * 1000

type Service struct {
	d   Deps
	cfg config.Authentication
}

func NewService(d Deps) *Service { return &Service{d: d, cfg: d.Config.Authentication} }

// ───────────────────────────── helpers ─────────────────────────────

func (s *Service) now() time.Time { return s.d.Clock.Now() }

func (s *Service) event(ctx context.Context, typ, outcome string, rc RequestContext, userID, actorID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	return s.d.Store.RecordEvent(ctx, EventRecord{
		ID: NewID(), Type: typ, Outcome: outcome, OccurredAt: s.now(),
		UserID: strPtr(userID), ActorID: strPtr(actorID),
		IPAddress: strPtr(rc.IPAddress), UserAgent: strPtr(rc.UserAgent), RequestID: strPtr(rc.RequestID),
		Metadata: metadata,
	})
}

// limit counts a hit and returns RATE_LIMITED when blocked.
func (s *Service) limit(ctx context.Context, key string, rule config.RateLimitRule, rc RequestContext) error {
	result, err := s.d.Limiter.Hit(ctx, key, LimitRule{Limit: rule.Limit, WindowSeconds: rule.WindowSeconds})
	if err != nil {
		return err
	}
	if result.JustBlocked {
		// The key's scope (e.g. "login:acct") is logged; the identifier itself is not.
		parts := strings.SplitN(key, ":", 3)
		scope := strings.Join(parts[:min(2, len(parts))], ":")
		if err := s.event(ctx, "rate_limit.triggered", "failure", rc, "", "", map[string]any{"scope": scope}); err != nil {
			return err
		}
	}
	if !result.Allowed {
		return &Error{Code: RateLimited, Message: messages[RateLimited], RetryAfterSeconds: result.RetryAfterSeconds}
	}
	return nil
}

func requireEmail(input any) (email, normalized string, err error) {
	e, ok := ValidateEmail(input)
	if !ok {
		return "", "", validation("Enter a valid email address.", "email", "invalid_format")
	}
	return e, NormalizeEmail(e), nil
}

func requireString(input any, field string) (string, error) {
	str, ok := input.(string)
	if !ok || str == "" {
		return "", validation(field+" is required.", field, "required")
	}
	return str, nil
}

func (s *Service) link(path, token string) string {
	base := *s.d.AppBaseURL
	if !strings.HasSuffix(base.Path, "/") {
		base.Path += "/"
	}
	base.RawQuery, base.Fragment = "", ""
	u := base.ResolveReference(&url.URL{Path: path})
	// The fragment keeps the token out of server logs and Referer headers (SEC-TOKEN-005).
	u.Fragment = "token=" + token
	return u.String()
}

func (s *Service) sendMail(ctx context.Context, kind EmailKind, to, subject, text string, link, token string) error {
	return s.d.Mailer.Send(ctx, EmailMessage{Kind: kind, To: to, Subject: subject, Text: text, Link: link, Token: token})
}

func (s *Service) issueToken(ctx context.Context, kind TokenKind, user UserRecord, ttlMinutes int) (string, error) {
	now := s.now()
	// A new token supersedes earlier unused ones (AUTHN-RESET-004, AUTHN-VERIFY-003).
	if err := s.d.Store.InvalidateUserTokens(ctx, user.ID, kind, now); err != nil {
		return "", err
	}
	token := RandomToken()
	var email *string
	if kind == TokenEmailVerification {
		email = user.EmailNormalized
	}
	err := s.d.Store.CreateToken(ctx, TokenRecord{
		ID: NewID(), Kind: kind, UserID: user.ID, TokenHash: SHA256Hex(token), Email: email,
		ExpiresAt: now.Add(time.Duration(ttlMinutes) * time.Minute), CreatedAt: now,
	})
	return token, err
}

func (s *Service) sendVerification(ctx context.Context, user UserRecord) error {
	if user.Email == nil {
		return nil
	}
	token, err := s.issueToken(ctx, TokenEmailVerification, user, s.cfg.EmailVerification.TokenTTLMinutes)
	if err != nil {
		return err
	}
	link := s.link("verify-email", token)
	return s.sendMail(ctx, EmailVerification, *user.Email, "Verify your email address",
		"Open this link to verify your email address: "+link, link, token)
}

func (s *Service) createSession(ctx context.Context, user UserRecord, rc RequestContext) (IssuedSession, error) {
	now := s.now()
	absolute := now.Add(time.Duration(s.cfg.Sessions.AbsoluteTimeoutMinutes) * time.Minute)
	idle := now.Add(time.Duration(s.cfg.Sessions.IdleTimeoutMinutes) * time.Minute)
	if idle.After(absolute) {
		idle = absolute
	}
	token := RandomToken()
	session := SessionRecord{
		ID: NewID(), TokenHash: SHA256Hex(token), UserID: user.ID,
		CreatedAt: now, LastSeenAt: now, IdleExpiresAt: idle, AbsoluteExpiresAt: absolute,
		IPAddress: strPtr(rc.IPAddress), UserAgent: strPtr(rc.UserAgent), ReauthenticatedAt: &now,
	}
	if err := s.d.Store.CreateSession(ctx, session); err != nil {
		return IssuedSession{}, err
	}
	return IssuedSession{Token: token, Session: session}, nil
}

func (s *Service) PublicUser(ctx context.Context, user UserRecord) (PublicUser, error) {
	roles, err := s.d.Store.GetUserRoles(ctx, user.ID)
	if err != nil {
		return PublicUser{}, err
	}
	perms, err := s.d.Store.GetRolePermissions(ctx, roles)
	if err != nil {
		return PublicUser{}, err
	}
	roles, perms = append([]string{}, roles...), append([]string{}, perms...)
	sort.Strings(roles)
	sort.Strings(perms)
	return PublicUser{
		ID: user.ID, Email: user.Email, EmailVerified: user.EmailVerifiedAt != nil,
		State: user.State, Roles: roles, Permissions: perms,
	}, nil
}

func (s *Service) verifyCurrentPassword(ctx context.Context, a *Context, password any, rc RequestContext) error {
	rules := s.cfg.RateLimit.PasswordChange
	if err := s.limit(ctx, "pwchg:addr:"+rc.addr(), rules.PerAddress, rc); err != nil {
		return err
	}
	// Counted before the hash, atomically (see Login): concurrent guesses cannot exceed the limit.
	accountKey := "pwchg:acct:" + a.UserID
	if err := s.limit(ctx, accountKey, rules.PerAccount, rc); err != nil {
		return err
	}
	hash, found, err := s.d.Store.GetPasswordHash(ctx, a.UserID)
	if err != nil {
		return err
	}
	pw, isString := password.(string)
	if !isString || !found || !s.d.Hasher.Verify(hash, pw) {
		return Fail(InvalidCredentials)
	}
	return s.d.Limiter.Reset(ctx, accountKey)
}

func requirePermission(a *Context, permission string) error {
	if !a.Has(permission) {
		return Fail(Forbidden)
	}
	return nil
}

// requireRecentAuth: admin operations need a recent password entry (AUTHZ-ADMIN-004).
func (s *Service) requireRecentAuth(a *Context) error {
	var at int64
	if a.Session.ReauthenticatedAt != nil {
		at = a.Session.ReauthenticatedAt.UnixMilli()
	}
	window := int64(s.d.Config.Authorization.ReauthenticationWindowMinutes) * minuteMs
	if s.now().UnixMilli()-at > window {
		return Fail(ReauthenticationNeeded)
	}
	return nil
}

func (s *Service) isLastActiveAdmin(ctx context.Context, user UserRecord) (bool, error) {
	if user.State != StateActive {
		return false, nil
	}
	roles, err := s.d.Store.GetUserRoles(ctx, user.ID)
	if err != nil {
		return false, err
	}
	if !contains(roles, AdminRole) {
		return false, nil
	}
	n, err := s.d.Store.CountActiveUsersWithRole(ctx, AdminRole)
	return n <= 1, err
}

func contains[T comparable](list []T, v T) bool {
	for _, e := range list {
		if e == v {
			return true
		}
	}
	return false
}

func (s *Service) deleteUser(ctx context.Context, user UserRecord, actorID string, rc RequestContext) error {
	now := s.now()
	st := s.d.Store
	// IDENT-DELETE-001/002: tombstone, release the email, drop credentials, revoke everything.
	deleted := StateDeleted
	if err := st.UpdateUser(ctx, user.ID, UserPatch{State: &deleted, DeletedAt: &now, UpdatedAt: &now, ClearEmail: true}); err != nil {
		return err
	}
	if err := st.DeleteCredentials(ctx, user.ID); err != nil {
		return err
	}
	if _, err := st.RevokeUserSessions(ctx, user.ID, RevokedStateChanged, now, ""); err != nil {
		return err
	}
	if err := st.InvalidateUserTokens(ctx, user.ID, TokensAll, now); err != nil {
		return err
	}
	return s.event(ctx, "account.state_changed", "success", rc, user.ID, actorID,
		map[string]any{"from": string(user.State), "to": "deleted"})
}

// CSRFRejected records csrf.rejected, at most once per client address per minute (SEC-CSRF-005).
func (s *Service) CSRFRejected(ctx context.Context, rc RequestContext) error {
	result, err := s.d.Limiter.Hit(ctx, "csrf:addr:"+rc.addr(), LimitRule{Limit: 1, WindowSeconds: 60})
	if err != nil {
		return err
	}
	if result.Allowed {
		return s.event(ctx, "csrf.rejected", "failure", rc, "", "", nil)
	}
	return nil
}

// ─────────────────────────── registration ───────────────────────────

func (s *Service) Register(ctx context.Context, in Input, rc RequestContext) (RegisterResult, error) {
	email, normalized, err := requireEmail(in["email"])
	if err != nil {
		return RegisterResult{}, err
	}
	password, perr := CheckPasswordPolicy(in["password"], s.cfg.Password, email)
	if perr != nil {
		return RegisterResult{}, perr
	}
	rules := s.cfg.RateLimit.Register
	if err := s.limit(ctx, "register:addr:"+rc.addr(), rules.PerAddress, rc); err != nil {
		return RegisterResult{}, err
	}
	if err := s.limit(ctx, "register:acct:"+normalized, rules.PerAccount, rc); err != nil {
		return RegisterResult{}, err
	}

	// Hash on every path so timing does not reveal existing accounts (AUTHN-REG-010).
	passwordHash := s.d.Hasher.Hash(password)
	reveal := s.cfg.Registration.RevealExistingEmail

	existing, err := s.d.Store.FindUserByEmail(ctx, normalized)
	if err != nil {
		return RegisterResult{}, err
	}
	if existing != nil {
		return s.registerExisting(ctx, *existing, reveal)
	}

	mode := s.cfg.EmailVerification.Mode
	now := s.now()
	state := StateActive
	if mode == "required" {
		state = StatePending
	}
	user, err := s.d.Store.CreateUser(ctx, UserRecord{
		// Only server-chosen values; client-supplied state/roles/id are ignored (AUTHN-REG-002).
		ID: NewID(), Email: &email, EmailNormalized: &normalized, State: state, CreatedAt: now, UpdatedAt: now,
	}, passwordHash, s.d.Config.Authorization.DefaultRoles)
	if errors.Is(err, ErrEmailTaken) {
		// Lost a concurrent race for the same email (AUTHN-REG-007).
		winner, ferr := s.d.Store.FindUserByEmail(ctx, normalized)
		if ferr != nil {
			return RegisterResult{}, ferr
		}
		if winner != nil {
			return s.registerExisting(ctx, *winner, reveal)
		}
	}
	if err != nil {
		return RegisterResult{}, err
	}

	if err := s.event(ctx, "user.registered", "success", rc, user.ID, "", nil); err != nil {
		return RegisterResult{}, err
	}
	if mode != "off" {
		if err := s.sendVerification(ctx, user); err != nil {
			return RegisterResult{}, err
		}
	}
	if s.cfg.Registration.SignInAfterRegistration {
		issued, err := s.createSession(ctx, user, rc)
		if err != nil {
			return RegisterResult{}, err
		}
		pub, err := s.PublicUser(ctx, user)
		return RegisterResult{SignedIn: true, User: pub, Issued: issued}, err
	}
	return RegisterResult{}, nil
}

func (s *Service) registerExisting(ctx context.Context, existing UserRecord, reveal bool) (RegisterResult, error) {
	if reveal {
		return RegisterResult{}, Fail(EmailTaken) // AUTHN-REG-011 (opt-in)
	}
	// AUTHN-REG-005: same outcome as a new registration; the owner is told instead.
	if existing.Email != nil {
		err := s.sendMail(ctx, EmailAccountExists, *existing.Email, "Someone tried to create an account with your email",
			"An account already exists for this address. If this was you, sign in or reset your password. Otherwise you can ignore this message.", "", "")
		if err != nil {
			return RegisterResult{}, err
		}
	}
	return RegisterResult{}, nil
}

// ─────────────────────────────── login ───────────────────────────────

func (s *Service) Login(ctx context.Context, in Input, presentedToken string, rc RequestContext) (PublicUser, IssuedSession, error) {
	_, normalized, err := requireEmail(in["email"])
	if err != nil {
		return PublicUser{}, IssuedSession{}, err
	}
	password, err := requireString(in["password"], "password")
	if err != nil {
		return PublicUser{}, IssuedSession{}, err
	}
	fail := func(e error) (PublicUser, IssuedSession, error) { return PublicUser{}, IssuedSession{}, e }
	rules := s.cfg.RateLimit.Login
	if err := s.limit(ctx, "login:addr:"+rc.addr(), rules.PerAddress, rc); err != nil {
		return fail(err)
	}
	accountKey := "login:acct:" + normalized
	// Applies whether or not the account exists (AUTHN-LOGIN-006, SEC-RATE-004). The attempt is
	// counted here, before the slow password hash, in one atomic step: concurrent requests then
	// cannot all pass a read-only check and evaluate more guesses than the limit allows
	// (SEC-RATE-001). A verified password clears the count below.
	if err := s.limit(ctx, accountKey, rules.PerAccount, rc); err != nil {
		return fail(err)
	}

	st, hasher := s.d.Store, s.d.Hasher
	user, err := st.FindUserByEmail(ctx, normalized)
	if err != nil {
		return fail(err)
	}
	var storedHash string
	var hasHash bool
	if user != nil {
		if storedHash, hasHash, err = st.GetPasswordHash(ctx, user.ID); err != nil {
			return fail(err)
		}
	}
	verified := false
	if hasHash && utf8.RuneCountInString(password) <= s.cfg.Password.MaxLength {
		verified = hasher.Verify(storedHash, password)
	} else {
		hasher.VerifyDummy(password) // AUTHN-LOGIN-003
	}

	if user == nil || !verified {
		uid := ""
		if user != nil {
			uid = user.ID
		}
		if err := s.event(ctx, "auth.login.failed", "failure", rc, uid, "", nil); err != nil {
			return fail(err)
		}
		return fail(Fail(InvalidCredentials)) // AUTHN-LOGIN-002
	}

	// The right password ends the guessing, whatever the account's state.
	if err := s.d.Limiter.Reset(ctx, accountKey); err != nil {
		return fail(err)
	}
	// State is revealed only after the password is verified (AUTHN-LOGIN-004).
	if user.State != StateActive {
		if err := s.event(ctx, "auth.login.failed", "failure", rc, user.ID, "", map[string]any{"reason": string(user.State)}); err != nil {
			return fail(err)
		}
		if user.State == StatePending {
			return fail(Fail(EmailNotVerified))
		}
		return fail(Fail(AccountUnavailable))
	}

	if hasHash && hasher.NeedsRehash(storedHash) {
		if err := st.SetPasswordHash(ctx, user.ID, hasher.Hash(password), s.now()); err != nil { // SEC-HASH-004
			return fail(err)
		}
	}

	// Never adopt a client-supplied session; revoke whatever was presented (AUTHN-LOGIN-005).
	if presentedToken != "" {
		previous, err := st.FindSessionByTokenHash(ctx, SHA256Hex(presentedToken))
		if err != nil {
			return fail(err)
		}
		if previous != nil && previous.RevokedAt == nil {
			if err := st.RevokeSession(ctx, previous.ID, RevokedRotated, s.now()); err != nil {
				return fail(err)
			}
		}
	}
	issued, err := s.createSession(ctx, *user, rc)
	if err != nil {
		return fail(err)
	}
	if err := s.event(ctx, "auth.login.succeeded", "success", rc, user.ID, "", nil); err != nil {
		return fail(err)
	}
	pub, err := s.PublicUser(ctx, *user)
	return pub, issued, err
}

// ───────────────────────────── sessions ─────────────────────────────

// Authenticate validates a session token (AUTHN-SESS-003…006). It returns nil when unauthenticated.
func (s *Service) Authenticate(ctx context.Context, token string) (*Context, error) {
	if token == "" {
		return nil, nil
	}
	st := s.d.Store
	session, err := st.FindSessionByTokenHash(ctx, SHA256Hex(token))
	if err != nil || session == nil {
		return nil, err
	}
	now := s.now()
	if session.RevokedAt != nil || !now.Before(session.IdleExpiresAt) || !now.Before(session.AbsoluteExpiresAt) {
		return nil, nil
	}
	user, err := st.FindUserByID(ctx, session.UserID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.State != StateActive { // IDENT-STATE-004
		return nil, nil
	}

	if now.Sub(session.LastSeenAt) >= time.Duration(s.cfg.Sessions.TouchIntervalSeconds)*time.Second {
		// Sliding idle expiry, never beyond the absolute expiry (AUTHN-SESS-004).
		idle := now.Add(time.Duration(s.cfg.Sessions.IdleTimeoutMinutes) * time.Minute)
		if idle.After(session.AbsoluteExpiresAt) {
			idle = session.AbsoluteExpiresAt
		}
		if err := st.TouchSession(ctx, session.ID, now, idle); err != nil {
			return nil, err
		}
		session.LastSeenAt, session.IdleExpiresAt = now, idle
	}

	// Roles and permissions are read on every request (AUTHZ-CORE-006).
	roles, err := st.GetUserRoles(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	perms, err := st.GetRolePermissions(ctx, roles)
	if err != nil {
		return nil, err
	}
	set := make(map[string]struct{}, len(perms))
	for _, p := range perms {
		set[p] = struct{}{}
	}
	return &Context{Subject: Subject{UserID: user.ID, Roles: roles, Permissions: set}, Session: *session, User: *user}, nil
}

func (s *Service) Logout(ctx context.Context, token string, rc RequestContext) error {
	if token == "" {
		return nil // AUTHN-LOGOUT-003
	}
	session, err := s.d.Store.FindSessionByTokenHash(ctx, SHA256Hex(token))
	if err != nil || session == nil || session.RevokedAt != nil {
		return err
	}
	if err := s.d.Store.RevokeSession(ctx, session.ID, RevokedLogout, s.now()); err != nil {
		return err
	}
	return s.event(ctx, "auth.logout", "success", rc, session.UserID, "", nil)
}

func (s *Service) LogoutAll(ctx context.Context, a *Context, rc RequestContext) error {
	if _, err := s.d.Store.RevokeUserSessions(ctx, a.UserID, RevokedLogoutAll, s.now(), ""); err != nil {
		return err
	}
	return s.event(ctx, "auth.sessions.revoked_all", "success", rc, a.UserID, "", nil)
}

// SessionSummary is the session part of GET /me.
type SessionSummary struct {
	ID                string `json:"id"`
	CreatedAt         string `json:"createdAt"`
	IdleExpiresAt     string `json:"idleExpiresAt"`
	AbsoluteExpiresAt string `json:"absoluteExpiresAt"`
}

// CurrentUser is the body of GET /me (without the CSRF token).
type CurrentUser struct {
	User    PublicUser     `json:"user"`
	Session SessionSummary `json:"session"`
}

func (s *Service) CurrentUser(ctx context.Context, a *Context) (CurrentUser, error) {
	pub, err := s.PublicUser(ctx, a.User)
	return CurrentUser{User: pub, Session: SessionSummary{
		ID: a.Session.ID, CreatedAt: ISO(a.Session.CreatedAt),
		IdleExpiresAt: ISO(a.Session.IdleExpiresAt), AbsoluteExpiresAt: ISO(a.Session.AbsoluteExpiresAt),
	}}, err
}

// ListedSession is one entry of GET /sessions.
type ListedSession struct {
	ID         string  `json:"id"`
	Current    bool    `json:"current"`
	CreatedAt  string  `json:"createdAt"`
	LastSeenAt string  `json:"lastSeenAt"`
	UserAgent  *string `json:"userAgent"`
}

func (s *Service) ListSessions(ctx context.Context, a *Context) ([]ListedSession, error) {
	sessions, err := s.d.Store.ListActiveSessions(ctx, a.UserID, s.now())
	out := make([]ListedSession, 0, len(sessions))
	for _, x := range sessions {
		out = append(out, ListedSession{
			ID: x.ID, Current: x.ID == a.Session.ID, CreatedAt: ISO(x.CreatedAt),
			LastSeenAt: ISO(x.LastSeenAt), UserAgent: x.UserAgent,
		})
	}
	return out, err
}

func (s *Service) RevokeSession(ctx context.Context, a *Context, sessionID string, rc RequestContext) error {
	session, err := s.d.Store.FindSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session == nil || session.UserID != a.UserID || session.RevokedAt != nil {
		return Fail(NotFound)
	}
	if err := s.d.Store.RevokeSession(ctx, session.ID, RevokedLogout, s.now()); err != nil {
		return err
	}
	return s.event(ctx, "auth.logout", "success", rc, a.UserID, "", map[string]any{"sessionId": session.ID})
}

// ─────────────────────────── email verification ───────────────────────────

func (s *Service) RequestEmailVerification(ctx context.Context, in Input, rc RequestContext) error {
	_, normalized, err := requireEmail(in["email"])
	if err != nil {
		return err
	}
	rules := s.cfg.RateLimit.VerificationResend
	if err := s.limit(ctx, "verify:addr:"+rc.addr(), rules.PerAddress, rc); err != nil {
		return err
	}
	if err := s.limit(ctx, "verify:acct:"+normalized, rules.PerAccount, rc); err != nil {
		return err
	}
	if s.cfg.EmailVerification.Mode == "off" {
		return nil
	}
	user, err := s.d.Store.FindUserByEmail(ctx, normalized)
	if err != nil {
		return err
	}
	// Same outcome whatever the account's status (AUTHN-VERIFY-001).
	if user != nil && user.EmailVerifiedAt == nil && (user.State == StatePending || user.State == StateActive) {
		return s.sendVerification(ctx, *user)
	}
	return nil
}

func (s *Service) VerifyEmail(ctx context.Context, in Input, rc RequestContext) error {
	raw, _ := in["token"].(string)
	st := s.d.Store
	now := s.now()
	var token *TokenRecord
	var user *UserRecord
	var err error
	if raw != "" {
		if token, err = st.FindToken(ctx, TokenEmailVerification, SHA256Hex(raw)); err != nil {
			return err
		}
	}
	if token != nil {
		if user, err = st.FindUserByID(ctx, token.UserID); err != nil {
			return err
		}
	}
	valid := token != nil && user != nil && token.UsedAt == nil && token.InvalidatedAt == nil &&
		now.Before(token.ExpiresAt) && (user.State == StatePending || user.State == StateActive) &&
		token.Email != nil && user.EmailNormalized != nil && *token.Email == *user.EmailNormalized // AUTHN-VERIFY-005
	if !valid {
		return Fail(TokenInvalid)
	}
	consumed, err := st.ConsumeToken(ctx, token.ID, now)
	if err != nil {
		return err
	}
	if !consumed {
		return Fail(TokenInvalid)
	}

	patch := UserPatch{EmailVerifiedAt: &now, UpdatedAt: &now}
	if user.State == StatePending {
		active := StateActive
		patch.State = &active
	}
	if err := st.UpdateUser(ctx, user.ID, patch); err != nil {
		return err
	}
	if err := s.event(ctx, "email.verified", "success", rc, user.ID, "", nil); err != nil {
		return err
	}
	if user.State == StatePending {
		return s.event(ctx, "account.state_changed", "success", rc, user.ID, user.ID, map[string]any{"from": "pending", "to": "active"})
	}
	return nil
}

// ─────────────────────────── password change ───────────────────────────

func (s *Service) ChangePassword(ctx context.Context, a *Context, in Input, rc RequestContext) (IssuedSession, error) {
	if err := s.verifyCurrentPassword(ctx, a, in["currentPassword"], rc); err != nil {
		return IssuedSession{}, err
	}
	email := ""
	if a.User.Email != nil {
		email = *a.User.Email
	}
	next, perr := CheckPasswordPolicy(in["newPassword"], s.cfg.Password, email)
	if perr != nil {
		return IssuedSession{}, perr
	}
	st := s.d.Store
	now := s.now()
	if err := st.SetPasswordHash(ctx, a.UserID, s.d.Hasher.Hash(next), now); err != nil {
		return IssuedSession{}, err
	}
	// AUTHN-PWCHG-003: other sessions revoked; the current one is replaced.
	if _, err := st.RevokeUserSessions(ctx, a.UserID, RevokedPasswordChanged, now, a.Session.ID); err != nil {
		return IssuedSession{}, err
	}
	if err := st.RevokeSession(ctx, a.Session.ID, RevokedRotated, now); err != nil {
		return IssuedSession{}, err
	}
	issued, err := s.createSession(ctx, a.User, rc)
	if err != nil {
		return IssuedSession{}, err
	}
	if err := st.InvalidateUserTokens(ctx, a.UserID, TokenPasswordReset, now); err != nil { // AUTHN-PWCHG-004
		return IssuedSession{}, err
	}
	if err := s.d.Limiter.Reset(ctx, "pwchg:acct:"+a.UserID); err != nil {
		return IssuedSession{}, err
	}
	if err := s.event(ctx, "password.changed", "success", rc, a.UserID, "", nil); err != nil {
		return IssuedSession{}, err
	}
	if a.User.Email != nil {
		if err := s.sendMail(ctx, EmailPasswordChanged, *a.User.Email, "Your password was changed",
			"Your password was just changed. If this was not you, reset your password immediately.", "", ""); err != nil {
			return IssuedSession{}, err
		}
	}
	return issued, nil
}

// ─────────────────────────── password reset ───────────────────────────

func (s *Service) RequestPasswordReset(ctx context.Context, in Input, rc RequestContext) error {
	_, normalized, err := requireEmail(in["email"])
	if err != nil {
		return err
	}
	rules := s.cfg.RateLimit.PasswordResetRequest
	if err := s.limit(ctx, "reset:addr:"+rc.addr(), rules.PerAddress, rc); err != nil {
		return err
	}
	if err := s.limit(ctx, "reset:acct:"+normalized, rules.PerAccount, rc); err != nil {
		return err
	}
	user, err := s.d.Store.FindUserByEmail(ctx, normalized)
	if err != nil {
		return err
	}
	// AUTHN-RESET-002: only active or pending accounts receive a token.
	if user == nil || user.Email == nil || (user.State != StateActive && user.State != StatePending) {
		return nil
	}
	token, err := s.issueToken(ctx, TokenPasswordReset, *user, s.cfg.PasswordReset.TokenTTLMinutes)
	if err != nil {
		return err
	}
	link := s.link("reset-password", token)
	if err := s.sendMail(ctx, EmailPasswordReset, *user.Email, "Reset your password",
		"Open this link to choose a new password: "+link+"\nIf you did not ask for this, ignore this email.", link, token); err != nil {
		return err
	}
	return s.event(ctx, "password.reset.requested", "success", rc, user.ID, "", nil)
}

func (s *Service) ResetPassword(ctx context.Context, in Input, rc RequestContext) error {
	raw, _ := in["token"].(string)
	st := s.d.Store
	var token *TokenRecord
	var user *UserRecord
	var err error
	if raw != "" {
		if token, err = st.FindToken(ctx, TokenPasswordReset, SHA256Hex(raw)); err != nil {
			return err
		}
	}
	if token != nil {
		if user, err = st.FindUserByID(ctx, token.UserID); err != nil {
			return err
		}
	}
	now := s.now()
	usable := token != nil && user != nil && token.UsedAt == nil && token.InvalidatedAt == nil &&
		now.Before(token.ExpiresAt) && (user.State == StateActive || user.State == StatePending) // AUTHN-RESET-007
	if !usable {
		return Fail(TokenInvalid)
	}

	// Policy is checked before consuming, so a violation keeps the token usable (AUTHN-RESET-008).
	email := ""
	if user.Email != nil {
		email = *user.Email
	}
	next, perr := CheckPasswordPolicy(in["newPassword"], s.cfg.Password, email)
	if perr != nil {
		return perr
	}
	hash := s.d.Hasher.Hash(next)
	consumed, err := st.ConsumeToken(ctx, token.ID, now) // AUTHN-RESET-009
	if err != nil {
		return err
	}
	if !consumed {
		return Fail(TokenInvalid)
	}

	if err := st.SetPasswordHash(ctx, user.ID, hash, now); err != nil {
		return err
	}
	if user.State == StatePending {
		// AUTHN-RESET-011: the token proves control of the mailbox.
		active := StateActive
		if err := st.UpdateUser(ctx, user.ID, UserPatch{State: &active, EmailVerifiedAt: &now, UpdatedAt: &now}); err != nil {
			return err
		}
	}
	if _, err := st.RevokeUserSessions(ctx, user.ID, RevokedPasswordReset, now, ""); err != nil { // AUTHN-RESET-010
		return err
	}
	if err := st.InvalidateUserTokens(ctx, user.ID, TokenPasswordReset, now); err != nil {
		return err
	}
	if user.EmailNormalized != nil {
		if err := s.d.Limiter.Reset(ctx, "login:acct:"+*user.EmailNormalized); err != nil {
			return err
		}
	}
	if err := s.event(ctx, "password.reset.completed", "success", rc, user.ID, "", nil); err != nil {
		return err
	}
	if user.Email != nil {
		return s.sendMail(ctx, EmailPasswordResetComplete, *user.Email, "Your password was reset",
			"Your password was just reset and all sessions were signed out. If this was not you, contact support.", "", "")
	}
	return nil
}

// ─────────────────────────── account deletion ───────────────────────────

func (s *Service) DeleteAccount(ctx context.Context, a *Context, in Input, rc RequestContext) error {
	if err := s.verifyCurrentPassword(ctx, a, in["currentPassword"], rc); err != nil { // IDENT-DELETE-003
		return err
	}
	last, err := s.isLastActiveAdmin(ctx, a.User)
	if err != nil {
		return err
	}
	if last {
		return Fail(Conflict) // AUTHZ-ADMIN-003
	}
	return s.deleteUser(ctx, a.User, a.UserID, rc)
}

// ─────────────────────────── administration ───────────────────────────

func (s *Service) SetAccountState(ctx context.Context, a *Context, targetID string, in Input, rc RequestContext) error {
	if err := requirePermission(a, "auth.users.manage"); err != nil {
		return err
	}
	if err := s.requireRecentAuth(a); err != nil {
		return err
	}
	raw, _ := in["state"].(string)
	next := AccountState(raw)
	if !contains(accountStates, next) {
		return validation("Unknown account state.", "state", "invalid_value")
	}
	st := s.d.Store
	target, err := st.FindUserByID(ctx, targetID)
	if err != nil {
		return err
	}
	if target == nil {
		return Fail(NotFound)
	}
	if !contains(adminTransitions[target.State], next) {
		return Fail(Conflict) // IDENT-STATE-002
	}
	if next != StateActive {
		last, err := s.isLastActiveAdmin(ctx, *target)
		if err != nil {
			return err
		}
		if last {
			return Fail(Conflict)
		}
	}
	if next == StateDeleted {
		return s.deleteUser(ctx, *target, a.UserID, rc)
	}
	now := s.now()
	if err := st.UpdateUser(ctx, target.ID, UserPatch{State: &next, UpdatedAt: &now}); err != nil {
		return err
	}
	if next != StateActive {
		// IDENT-STATE-003, AUTHZ-ADMIN-006
		if _, err := st.RevokeUserSessions(ctx, target.ID, RevokedStateChanged, now, ""); err != nil {
			return err
		}
		if err := st.InvalidateUserTokens(ctx, target.ID, TokensAll, now); err != nil {
			return err
		}
	}
	return s.event(ctx, "account.state_changed", "success", rc, target.ID, a.UserID,
		map[string]any{"from": string(target.State), "to": string(next)})
}

// requireDelegable: without auth.roles.manage, only roles within the actor's own permissions (AUTHZ-ADMIN-002).
func (s *Service) requireDelegable(ctx context.Context, a *Context, role string) error {
	if a.Has("auth.roles.manage") {
		return nil
	}
	granted, err := s.d.Store.GetRolePermissions(ctx, []string{role})
	if err != nil {
		return err
	}
	for _, p := range granted {
		if !a.Has(p) {
			return Fail(Forbidden)
		}
	}
	return nil
}

func (s *Service) roleTarget(ctx context.Context, a *Context, targetID string, role any) (*UserRecord, string, error) {
	if err := requirePermission(a, "auth.roles.assign"); err != nil {
		return nil, "", err
	}
	if err := s.requireRecentAuth(a); err != nil {
		return nil, "", err
	}
	name, ok := role.(string)
	if ok {
		exists, err := s.d.Store.RoleExists(ctx, name)
		if err != nil {
			return nil, "", err
		}
		ok = exists
	}
	if !ok {
		return nil, "", Fail(NotFound)
	}
	target, err := s.d.Store.FindUserByID(ctx, targetID)
	if err != nil {
		return nil, "", err
	}
	if target == nil || target.State == StateDeleted {
		return nil, "", Fail(NotFound)
	}
	if err := s.requireDelegable(ctx, a, name); err != nil {
		return nil, "", err
	}
	return target, name, nil
}

func (s *Service) AssignRole(ctx context.Context, a *Context, targetID string, in Input, rc RequestContext) error {
	target, role, err := s.roleTarget(ctx, a, targetID, in["role"])
	if err != nil {
		return err
	}
	actor := a.UserID
	if err := s.d.Store.AddUserRole(ctx, target.ID, role, &actor, s.now()); err != nil {
		return err
	}
	return s.event(ctx, "role.assigned", "success", rc, target.ID, a.UserID, map[string]any{"role": role})
}

func (s *Service) RemoveRole(ctx context.Context, a *Context, targetID, role string, rc RequestContext) error {
	target, _, err := s.roleTarget(ctx, a, targetID, role)
	if err != nil {
		return err
	}
	if role == AdminRole {
		last, err := s.isLastActiveAdmin(ctx, *target)
		if err != nil {
			return err
		}
		if last {
			return Fail(Conflict)
		}
	}
	if err := s.d.Store.RemoveUserRole(ctx, target.ID, role); err != nil {
		return err
	}
	return s.event(ctx, "role.removed", "success", rc, target.ID, a.UserID, map[string]any{"role": role})
}
