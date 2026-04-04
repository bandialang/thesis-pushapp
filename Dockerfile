FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY README.md ./
COPY .env.example ./

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/index.js"]
