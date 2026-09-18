FROM node:20-alpine AS build
WORKDIR /app

# Vite bakes VITE_* vars in at build time — set this to the backend's public
# URL in Coolify's build-time environment variables, e.g.
# https://api-errances.socialmm.in
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
