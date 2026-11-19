package ginauth

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"selfauth-app/internal/auth"
	"selfauth-app/internal/httpx"
)

// authed returns the session context or an UNAUTHENTICATED error.
func (a *Auth) authed(c *gin.Context) (*auth.Context, bool) {
	session := a.Context(c)
	if session == nil {
		a.Abort(c, auth.Fail(auth.Unauthenticated))
		return nil, false
	}
	return session, true
}

// handler adapts a function that returns an error.
func (a *Auth) handler(fn func(c *gin.Context) error) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := fn(c); err != nil {
			a.Abort(c, err)
		}
	}
}

func noContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
}

// RegisterRoutes mounts the authentication routes on group, which must be the
// group for http.basePath (HTTP binding: AUTHENTICATION_SPEC §11).
func (a *Auth) RegisterRoutes(group *gin.RouterGroup) {
	group.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store") // AUTHN-ME-003, SEC-HTTP-001
		c.Header("Referrer-Policy", "no-referrer")
		c.Next()
	})
	svc := a.service
	ctx := detached

	group.POST("/register", a.handler(func(c *gin.Context) error {
		result, err := svc.Register(ctx(c), httpx.Body(c), a.rc(c))
		if err != nil {
			return err
		}
		if result.SignedIn {
			a.setSessionCookie(c, result.Issued)
			c.JSON(http.StatusCreated, a.csrfField(gin.H{"user": result.User}, result.Issued.Session.ID))
			return nil
		}
		c.JSON(http.StatusAccepted, gin.H{"status": "accepted"})
		return nil
	}))

	group.POST("/login", a.handler(func(c *gin.Context) error {
		presented, _ := c.Get(presentedKey)
		user, issued, err := svc.Login(ctx(c), httpx.Body(c), presented.(string), a.rc(c))
		if err != nil {
			return err
		}
		a.setSessionCookie(c, issued)
		c.JSON(http.StatusOK, a.csrfField(gin.H{"user": user}, issued.Session.ID))
		return nil
	}))

	group.POST("/logout", a.handler(func(c *gin.Context) error {
		presented, _ := c.Get(presentedKey)
		if err := svc.Logout(ctx(c), presented.(string), a.rc(c)); err != nil {
			return err
		}
		a.clearSessionCookie(c)
		noContent(c)
		return nil
	}))

	group.POST("/logout-all", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		if err := svc.LogoutAll(ctx(c), session, a.rc(c)); err != nil {
			return err
		}
		a.clearSessionCookie(c)
		noContent(c)
		return nil
	}))

	group.GET("/me", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		me, err := svc.CurrentUser(ctx(c), session)
		if err != nil {
			return err
		}
		c.JSON(http.StatusOK, a.csrfField(gin.H{"user": me.User, "session": me.Session}, session.Session.ID))
		return nil
	}))

	group.GET("/sessions", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		sessions, err := svc.ListSessions(ctx(c), session)
		if err != nil {
			return err
		}
		c.JSON(http.StatusOK, gin.H{"sessions": sessions})
		return nil
	}))

	group.DELETE("/sessions/:id", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		if err := svc.RevokeSession(ctx(c), session, c.Param("id"), a.rc(c)); err != nil {
			return err
		}
		noContent(c)
		return nil
	}))

	group.POST("/email/verification", a.handler(func(c *gin.Context) error {
		if err := svc.RequestEmailVerification(ctx(c), httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		c.JSON(http.StatusAccepted, gin.H{"status": "accepted"})
		return nil
	}))

	group.POST("/email/verify", a.handler(func(c *gin.Context) error {
		if err := svc.VerifyEmail(ctx(c), httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		c.JSON(http.StatusOK, gin.H{"status": "verified"})
		return nil
	}))

	group.POST("/password/change", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		issued, err := svc.ChangePassword(ctx(c), session, httpx.Body(c), a.rc(c))
		if err != nil {
			return err
		}
		a.setSessionCookie(c, issued)
		c.JSON(http.StatusOK, a.csrfField(gin.H{"status": "changed"}, issued.Session.ID))
		return nil
	}))

	group.POST("/password/reset-request", a.handler(func(c *gin.Context) error {
		if err := svc.RequestPasswordReset(ctx(c), httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		c.JSON(http.StatusAccepted, gin.H{"status": "accepted"})
		return nil
	}))

	group.POST("/password/reset", a.handler(func(c *gin.Context) error {
		if err := svc.ResetPassword(ctx(c), httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		noContent(c)
		return nil
	}))

	group.POST("/account/delete", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		if err := svc.DeleteAccount(ctx(c), session, httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		a.clearSessionCookie(c)
		noContent(c)
		return nil
	}))

	group.POST("/admin/users/:id/state", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		if err := svc.SetAccountState(ctx(c), session, c.Param("id"), httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		noContent(c)
		return nil
	}))

	group.POST("/admin/users/:id/roles", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		if err := svc.AssignRole(ctx(c), session, c.Param("id"), httpx.Body(c), a.rc(c)); err != nil {
			return err
		}
		noContent(c)
		return nil
	}))

	group.DELETE("/admin/users/:id/roles/:role", a.handler(func(c *gin.Context) error {
		session, ok := a.authed(c)
		if !ok {
			return nil
		}
		if err := svc.RemoveRole(ctx(c), session, c.Param("id"), c.Param("role"), a.rc(c)); err != nil {
			return err
		}
		noContent(c)
		return nil
	}))
}
