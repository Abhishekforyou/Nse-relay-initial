FROM mcr.microsoft.com/playwright:v1.54.2-jammy
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN npx playwright install --with-deps
ENV TZ=Asia/Kolkata
EXPOSE 8080
CMD ["npm","start"]
