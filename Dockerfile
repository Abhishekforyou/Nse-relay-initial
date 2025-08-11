FROM mcr.microsoft.com/playwright:v1.45.0-jammy
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV TZ=Asia/Kolkata
EXPOSE 8080
CMD ["npm","start"]
