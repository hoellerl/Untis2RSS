FROM node:22-slim
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# remove devDependencies to keep the image small
RUN npm prune --production

VOLUME /usr/src/app/data
EXPOSE 6565

HEALTHCHECK --interval=5m --timeout=3s \
  CMD node -e "require('http').get('http://localhost:6565/health', (res) => { if (res.statusCode !== 200) { process.exit(1); } }).on('error', () => process.exit(1));"

CMD [ "npm", "start" ]