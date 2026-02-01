# Étape 1 : Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Étape 2 : Production
FROM node:18-alpine
WORKDIR /app

# Créer un utilisateur non-root pour sécurité
RUN addgroup -g 1001 -S nodejs
RUN adduser -S youpi -u 1001

# Copier depuis le builder
COPY --from=builder --chown=youpi:nodejs /app/node_modules ./node_modules
COPY --chown=youpi:nodejs . .

USER youpi
EXPOSE 8080

# Santé check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/api/health', (r) => {if(r.statusCode!==200)throw new Error()})"

CMD ["node", "src/index.js"]