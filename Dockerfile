FROM node:18-alpine

# Copy application
COPY / ./

RUN npm config set registry https://registry.npmjs.org/ && npm install --production

EXPOSE 8080

CMD ["node", "src/index.mjs"]
