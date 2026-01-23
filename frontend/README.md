# La Artesa - Frontend

Sistema de Control de Producción - Interfaz Web

## Tecnologías

- **React 18** - Framework UI
- **TypeScript** - Lenguaje tipado
- **Vite** - Build tool
- **React Router** - Enrutamiento
- **TanStack Query** - Gestión de estado del servidor
- **Zustand** - Gestión de estado global
- **Tailwind CSS** - Estilos
- **Axios** - Cliente HTTP

## Estructura del Proyecto

```
frontend/
├── public/              # Archivos estáticos
├── src/
│   ├── config/         # Configuración de la API
│   ├── types/          # Tipos TypeScript
│   ├── services/       # Servicios API
│   ├── hooks/          # Hooks personalizados
│   ├── store/          # Stores Zustand
│   ├── components/     # Componentes React
│   ├── pages/          # Páginas/Vistas
│   ├── utils/          # Utilidades
│   └── styles/         # Estilos globales
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Instalación

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env

# Configurar la URL de la API en .env
VITE_API_URL=http://localhost:3000/api
```

## Desarrollo

```bash
# Iniciar servidor de desarrollo
npm run dev

# El servidor estará disponible en http://localhost:5173
```

## Build

```bash
# Crear build de producción
npm run build

# Preview del build
npm run preview
```

## Características Principales

### Módulos

1. **Dashboard** - Vista general de producción
2. **Sincronización SAP** - Importar órdenes
3. **Planificación** - Gestión de masas y productos
4. **Pesaje** - Control de ingredientes
5. **Amasado** - Control de amasado (Fase 2)
6. **División** - Control de división (Fase 3)
7. **Configuración** - Parámetros del sistema

### Fases de Producción

1. Pesaje
2. Amasado
3. División
4. Formado
5. Fermentación
6. Horneado

## Estado Actual

Este es el scaffolding inicial del proyecto. Los siguientes componentes están pendientes de implementación:

- Componentes de masas
- Componentes de fases
- Componentes de configuración
- Componentes de dashboard
- Lógica de negocio completa
- Integración con API backend

## Próximos Pasos

1. Implementar componentes de masas
2. Implementar componentes de fases
3. Conectar con API backend
4. Agregar validaciones de formularios
5. Implementar manejo de errores
6. Agregar tests unitarios
7. Optimizar rendimiento

## Variables de Entorno

- `VITE_API_URL` - URL base de la API
- `VITE_APP_NAME` - Nombre de la aplicación
- `VITE_APP_VERSION` - Versión de la aplicación

## Contribución

Este proyecto es parte del sistema de control de producción de La Artesa.
