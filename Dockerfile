FROM node:20-slim

# Install system dependencies, OpenSSL, PostgreSQL and Redis
RUN apt-get update && apt-get install -y openssl postgresql postgresql-contrib redis-server && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

RUN chmod +x ./entrypoint.sh

EXPOSE 3000
EXPOSE 80

CMD ["./entrypoint.sh"]
