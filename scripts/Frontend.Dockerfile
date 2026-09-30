FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY shared ./shared
COPY 01-service-requests/frontend ./01-service-requests/frontend
COPY 02-data-quality-portal/frontend ./02-data-quality-portal/frontend
COPY 03-fleet-monitor/frontend ./03-fleet-monitor/frontend
COPY 04-parcel-scenarios/frontend ./04-parcel-scenarios/frontend
COPY 05-infrastructure-inspections/frontend ./05-infrastructure-inspections/frontend
RUN npm ci
ARG PROJECT
RUN npm run build --workspace ./${PROJECT}/frontend && cp -r ${PROJECT}/frontend/dist /site
FROM nginx:alpine
COPY scripts/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
EXPOSE 80
