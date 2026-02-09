FROM node:18-alpine
WORKDIR /app

# 1. Installation des outils de compilation (nécessaire pour bcrypt)
RUN apk add --no-cache python3 make g++

# 2. Définir la variable d'environnement AVANT npm install
ENV npm_config_ignore_scripts=true

# 3. Copier seulement les fichiers de dépendances d'abord (pour optimiser le cache)
COPY package*.json ./

# 4. Installation des dépendances avec npm ci (plus fiable que npm install)
RUN npm ci --omit=dev --ignore-scripts

# 5. Reconstruire bcrypt pour l'environnement Alpine
RUN npm rebuild bcrypt --update-binary

# 6. Copier le reste du code source
COPY . .

# 7. Exposer le port
EXPOSE 10000

# 8. Lancer l'application
CMD ["node", "src/index.js"]