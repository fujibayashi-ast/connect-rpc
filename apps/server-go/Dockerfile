FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/server .

FROM alpine:3
COPY --from=build /out/server /server
ENV PORT=8080
EXPOSE 8080
CMD ["/server"]
