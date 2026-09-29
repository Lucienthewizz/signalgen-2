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
	engine.Use(gin.Recovery())
	return &Router{engine: engine}
}

func (router *Router) Handle(method, path string, handler stdhttp.HandlerFunc) {
	router.engine.Handle(method, path, func(ctx *gin.Context) {
		for _, param := range ctx.Params {
			ctx.Request.SetPathValue(param.Key, param.Value)
		}
		handler(ctx.Writer, ctx.Request)
	})
}

func (router *Router) Handler() stdhttp.Handler { return router.engine }
