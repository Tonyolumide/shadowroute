# Self-contained build of tee-proxy. Clones tee-proxy from GitHub at build time
# so no local sibling repos are needed.
#
# Coston2's redeployed FCC stack requires the current tee-proxy develop line.
# Pin the reviewed develop commit rather than a moving branch so the hackathon
# image remains reproducible.

ARG TEE_PROXY_REF=0c6d016b09948cba9a508ba357e592eb6088fd1c

# NOTE: not pinned by digest (unlike the main Dockerfile) — this is a dev convenience build.
# For full reproducibility, pin by digest: golang:1.25.1-alpine@sha256:...
FROM golang:1.25.8-alpine AS builder

RUN apk add --no-cache git

ARG TEE_PROXY_REF

WORKDIR /app
RUN git clone https://github.com/flare-foundation/tee-proxy.git && \
    cd tee-proxy && git checkout --detach ${TEE_PROXY_REF}

WORKDIR /app/tee-proxy
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -a -o main ./cmd/proxy

# Final stage
FROM alpine:3.21

WORKDIR /app

COPY --from=builder /app/tee-proxy/main .
# The Coston2 compose service mounts its reviewed config at runtime. Current
# develop no longer ships the historical root config.example.toml.

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 6661
EXPOSE 6662

CMD ["./main"]
