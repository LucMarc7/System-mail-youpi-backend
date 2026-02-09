FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
COPY . .
EXPOSE 10000
CMD ["node", "src/index.js"]
ENV npm_config_ignore_scripts=true
RUN npm install --only=production --omit=dev