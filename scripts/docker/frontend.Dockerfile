# Frontend images (saiflow-fe-<APP>). Build context: repo root.
#   docker build -f scripts/docker/frontend.Dockerfile --build-arg APP=web-pc .
FROM node:24-alpine AS build
ARG APP
# Public build-time settings (Vite reads VITE_* from the environment): the LIFF app ID
# (line-mini; web-pc's register and invitation links) and the LINE Login channel ID (web-pc).
ARG VITE_LIFF_ID
ENV VITE_LIFF_ID=$VITE_LIFF_ID
ARG VITE_LINE_CHANNEL_ID
ENV VITE_LINE_CHANNEL_ID=$VITE_LINE_CHANNEL_ID
RUN test -n "$APP" && corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "@saiflow/${APP}" build

FROM nginx:stable-alpine
ARG APP
COPY scripts/docker/nginx-static.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 8080
