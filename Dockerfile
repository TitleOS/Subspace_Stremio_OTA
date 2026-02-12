FROM node:18-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm install --production
# COPY . . ensures placeholder.png is included
COPY . . 
EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:7000/health || exit 1
CMD ["node", "addon.js"]
