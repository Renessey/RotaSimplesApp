# FASE 5 — BANCO LOCAL / SERVIÇOS INTERNOS

## Progresso

### Task 5.1 — Criar banco SQLite local
- [x] `@op-engineering/op-sqlite` já instalado (FASE 4)
- [x] `src/database/database.ts` abre o banco (singleton `getDatabase()`)

### Task 5.2 — Criar migrations
- [x] Criar `src/database/migrations.ts` com runner versionado via `PRAGMA user_version`
- [x] Migração 1: cria tabela `entregas` (schema da spec)
- [x] Migração 2: migra dados de `deliveries` (legado FASE 4) para `entregas`
- [x] Integrar as migrations na inicialização do `database.ts`

### Task 5.3 — Criar tabela entregas
- [x] Schema `entregas` com colunas: id, codigo_rastreio, nome_destinatario, telefone, endereco, numero, complemento, bairro, cidade, cep, latitude, longitude, ordem_entrega, status, observacao, criado_em
- [x] Índice único em `codigo_rastreio` + índice de busca

### Task 5.4 — Criar DeliveryRepository
- [x] `createEntrega()`
- [x] `getEntregas()`
- [x] `getEntregaById()`
- [x] `updateEntrega()`
- [x] `deleteEntrega()`
- [x] Aliases retrocompatíveis (insertDelivery, listDeliveries, etc.) para a UI da FASE 4

### Task 5.5 — Criar serviço de sincronização futura
- [x] Estender `DeliverySyncService` com payload do novo schema (status, lat/long)

### Task 5.6 — Criar cache offline
- [x] Criar `src/cache/OfflineCache.ts` (tabela chave→valor no SQLite)

### Task 5.7 — Criar controle de status das entregas
- [x] Criar `src/status/DeliveryStatus.ts` (enum, transições válidas, helpers)

---

# FASE 4 — IMPORTAÇÃO XLSX / CSV

## Progresso

### Task 4.1 — Instalar SheetJS (xlsx)
- [x] Instalar `xlsx@0.18.5`

### Task 4.2 — Instalar file picker compatível com RN CLI
- [x] Instalar `@react-native-documents/picker@12.0.2` (substitui `react-native-document-picker`, que foi renomeado)
- [x] Instalar `react-native-fs@2.20.0` para ler o arquivo selecionado (base64)

### Task 4.3 — Criar ImportScreen
- [x] Criar `src/screens/ImportScreen.tsx` (reutiliza o `DeliveryManagerPanel`)

### Task 4.4 — Criar área "Gerenciamento de Entregas" abaixo do mapa
- [x] Criar `src/components/DeliveryManagerPanel.tsx`
- [x] Integrar o painel abaixo do mapa no `MapScreen` (mapa no topo, painel na base)
- [x] Estrutura preparada para: importar, visualizar, filtrar, pesquisar, excluir, limpar, rotas e status

### Task 4.5 — Selecionar arquivo XLSX/CSV
- [x] `FileReader.pickSpreadsheetFile()` via `@react-native-documents/picker` (types: csv, xls, xlsx)

### Task 4.6 — Ler arquivo
- [x] `keepLocalCopy` + `RNFS.readFile(uri, 'base64')` → retorna `{ base64, fileName, localUri }`

### Task 4.7 — Criar SpreadsheetParser
- [x] Criar `src/services/import/SpreadsheetParser.ts`

### Task 4.8 — Converter planilha em objetos TypeScript
- [x] `parseSheet()` converte a planilha (via `XLSX.read`) em objetos `Delivery[]`

### Task 4.9 — Detectar colunas automaticamente
- [x] Mapa de cabeçalhos PT-BR (Código de rastreio, Nome, Telefone, Endereço, Número, Complemento, Bairro, Cidade, CEP)
- [x] Detecção insensível a acentos/caixa
- [x] Campos principais: Nome, Endereço, CEP

### Task 4.10 — Normalizar dados
- [x] Trim de textos, CEP só dígitos (8), telefone só dígitos, número detectado

### Task 4.11 — Validar registros
- [x] Obrigatórios Nome, Endereço e CEP + formato de CEP (8 dígitos)

### Task 4.12 — Mostrar prévia da importação
- [x] Prévia com contagem de linhas válidas/inválidas, amostra das primeiras entregas e colunas detectadas

### Task 4.13 — Mostrar erros de linhas inválidas
- [x] Lista de erros por número de linha

### Task 4.14 — Criar modelo Delivery/Entrega no TypeScript
- [x] Criar `src/types/import.ts` com `Delivery`, `ImportColumnId`, `DetectedColumn`, `RowValidationError`, `SpreadsheetParseResult`, `ImportPreview`

### Task 4.15 — Criar camada de persistência local
- [x] Criar `src/database/DeliveryRepository.ts`

### Task 4.16 — Criar banco SQLite local
- [x] Instalar `@op-engineering/op-sqlite@17.1.5` (mantido, compatível com New Architecture e RN CLI)
- [x] (Alteração) `react-native-sqlite-storage` foi removido — usava `jcenter()` (removido no Gradle 8+) e AGP 3.1.4, incompatíveis com o toolchain atual
- [x] Criar `src/database/database.ts` (singleton `getDatabase()` via `open()` do op-sqlite)

### Task 4.17 — Criar tabela de entregas
- [x] Tabela `deliveries` com colunas completas + índices (tracking único e busca por nome/endereço)

### Task 4.18 — Salvar entregas importadas no SQLite
- [x] `insertDeliveries()` / `insertDelivery()` persistem as entregas confirmadas

### Task 4.19 — Impedir duplicação de entregas
- [x] Índice UNIQUE em `tracking_code` + verificação por combo nome+endereço+número+cidade+CEP

### Task 4.20 — Criar tela/listagem de entregas
- [x] Criar `src/screens/DeliveriesScreen.tsx` (FlatList) + listagem no painel

### Task 4.21 — Permitir pesquisar e filtrar entregas
- [x] Campo de pesquisa (nome, endereço, cidade, CEP, tracking) no painel e na tela

### Task 4.22 — Permitir excluir uma entrega
- [x] Botão "Excluir" com confirmação (`deleteDelivery`)

### Task 4.23 — Permitir excluir uma importação inteira
- [x] Botão "Limpar" com confirmação (`clearDeliveries`)

### Task 4.24 — Preparar arquitetura para futura sincronização com API
- [x] Criar `src/services/import/DeliverySyncService.ts` (`buildSyncPayload`, `syncDelivery`, `syncDeliveries`, `requireApiUrl`)

### Configuração Android
- [x] Adicionar permissão `READ_EXTERNAL_STORAGE` (maxSdkVersion 32) ao `AndroidManifest.xml`
