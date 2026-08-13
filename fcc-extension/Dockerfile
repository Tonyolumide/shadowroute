FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /shadowroute-extension .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /shadowroute-extension /shadowroute-extension
ENV SHADOWROUTE_LISTEN_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/shadowroute-extension"]
