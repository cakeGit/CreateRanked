FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache cronie bash

COPY package.json ./
RUN npm install --production

COPY . .

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh && chmod +x update.sh

RUN echo "0 0 * * * /update.sh >> /update.log 2>&1" | crontab -

ENTRYPOINT ["./entrypoint.sh"]
