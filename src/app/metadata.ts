/** Nombre y versión de la aplicación, inyectados por Vite desde package.json. */
export const APP_NAME = 'GitThul';

/** `__APP_VERSION__` lo define vite.config.ts a partir de package.json. */
export const APP_VERSION = __APP_VERSION__;

/*
 * Destinos de Ayuda, Apoyar y «Acerca de». Salen por `LinkPort`, al navegador
 * del sistema. Son metadatos centralizados para poder sustituir los destinos sin
 * buscar literales por toda la interfaz.
 */
export const APP_SITE_URL = 'https://gitthul.com';
export const APP_HELP_URL = 'https://gitthul.com/help';
export const APP_SUPPORT_URL = 'https://gitthul.com/support';

/**
 * La licencia, escrita como identificador SPDX.
 *
 * No pasa por i18n a propósito: «MIT» es un identificador y no una
 * frase, y traducirlo lo convertiría en algo que ya no nombra la misma licencia.
 */
export const APP_LICENSE = 'MIT';
