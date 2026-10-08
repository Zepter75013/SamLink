# ============================================
# Stage 1: Build de l'application React
# ============================================
FROM node:22-alpine AS builder

WORKDIR /app

# Chemin relatif, proxié en interne par nginx vers le backend (voir
# nginx.conf) — pas de domaine/port à connaître au moment du build.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ============================================
# Stage 2: Serveur Nginx
# ============================================
FROM nginx:alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html
# Les fichiers venant du Mac peuvent être en lecture réservée à leur propriétaire (logo, icônes, sw.js) :
# nginx doit pouvoir tous les lire.
RUN chmod -R a+rX /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
