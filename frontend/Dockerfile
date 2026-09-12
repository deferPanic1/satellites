# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

ENV CI=1
# Слой с зависимостями кэшируется отдельно от исходников
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime

# Cesium отдаёт .wasm. Добавляем тип в общую таблицу mime.types, а не блоком
# types{} внутри server — тот бы затёр всю таблицу целиком.
RUN grep -q 'application/wasm' /etc/nginx/mime.types || \
    sed -i '$ s|^}|    application/wasm                                 wasm;\n}|' /etc/nginx/mime.types

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Файлы из public/ могут иметь локальные права 0600. Vite dev-сервер читает
# их от пользователя разработчика, но nginx worker в runtime-образе работает
# от отдельного пользователя и в таком случае отвечает 403. Нормализуем права
# только у готовой статики внутри образа; исходники на хосте не меняются.
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
