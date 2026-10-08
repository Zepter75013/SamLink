FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/api ./cmd/api && CGO_ENABLED=0 go build -o /out/migrate ./cmd/migrate

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/api /app/api
# Création des tables de Sam Link et de la vue : docker exec samlink-backend /app/migrate
COPY --from=build /out/migrate /app/migrate
COPY migrations /app/migrations
EXPOSE 8080
ENTRYPOINT ["/app/api"]
