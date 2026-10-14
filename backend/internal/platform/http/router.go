package http

import (
	stdhttp "net/http"

	"github.com/gin-gonic/gin"
)

// Router is the sole Gin adapter. Feature handlers remain standard
// net/http functions, keeping them framework-light and easy to test.
type Router struct {
	engine *gin.Engine
}

func NewRouter() *Router {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	// Gin's default recovery logger can dump requests/panic values, including
	// custom session headers or ticket query strings. Recover without that dump.
	engine.Use(safeRecovery)
	return &Router{engine: engine}
}

func (router *Router) Handle(method, path string, handler stdhttp.HandlerFunc) {
	router.engine.Handle(method, path, func(ctx *gin.Context) {
		LabelRoute(ctx.Request, path)
		for _, param := range ctx.Params {
			ctx.Request.SetPathValue(param.Key, param.Value)
		}
		handler(ctx.Writer, ctx.Request)
	})
}

func (router *Router) Handler() stdhttp.Handler { return router.engine }

// safeRecovery preserves the JSON error contract without exposing panic data.
// A partially written response cannot be replaced; abort its connection instead.
func safeRecovery(ctx *gin.Context) {
	defer func() {
		if failure := recover(); failure != nil {
			if failure != stdhttp.ErrAbortHandler {
				markRequestPanic(ctx.Request)
			}
			ctx.Abort()
			if ctx.Writer.Written() || failure == stdhttp.ErrAbortHandler {
				panic(stdhttp.ErrAbortHandler)
			}
			WriteError(ctx.Writer, ctx.Request, stdhttp.StatusInternalServerError, "INTERNAL_ERROR", "Terjadi kesalahan internal.")
		}
	}()
	ctx.Next()
}
