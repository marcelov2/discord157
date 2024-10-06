# Use a imagem Node.js oficial
FROM node:18

# Define o diretório de trabalho
WORKDIR /usr/src/app

# Copia os arquivos do projeto
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o resto dos arquivos do projeto
COPY . .

# Exponha a porta 3000, se necessário
EXPOSE 3000

# Comando para rodar o aplicativo
CMD [ "node", "index.js" ]
