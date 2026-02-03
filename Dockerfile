FROM node:22-slim
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

VOLUME /usr/src/app/data
EXPOSE 6565

CMD [ "npm", "start" ]