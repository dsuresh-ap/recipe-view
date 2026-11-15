# The server only. Apple Notes can't be read from inside a container, so run
# `recipe-view export --watch` on the Mac and mount its folder at /data.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production \
    RECIPE_VIEW_DATA=/data \
    RECIPE_VIEW_PORT=4242 \
    RECIPE_VIEW_NO_EXPORT=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4242
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4242/healthz >/dev/null || exit 1
CMD ["node", "dist/cli.js", "serve"]
