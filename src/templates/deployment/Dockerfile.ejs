FROM mhart/alpine-node:16.4.2

RUN mkdir -p /var/www/api

RUN apk --no-cache add curl

ADD ./projects/api/package.json /var/www/api/package.json
ADD ./projects/api/package-lock.json /var/www/api/package-lock.json

COPY ./projects/api/dist ./var/www/api

RUN cd /var/www/api && npm install && npm cache clean --force

HEALTHCHECK --interval=60s --retries=5 CMD curl --fail http://localhost:3000/meta/ || exit 1

WORKDIR /var/www/api

EXPOSE 3000
