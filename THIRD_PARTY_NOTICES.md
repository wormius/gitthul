# Avisos de terceros

El código propio de GitThul se distribuye bajo [MIT](LICENSE). Las dependencias,
fuentes y bibliotecas externas mantienen sus licencias; no se relicencian como MIT
por formar parte de esta aplicación.

## Fuentes distribuidas

`src/design/fonts.css` utiliza nueve familias empaquetadas por Fontsource. Los
textos originales de licencia de las versiones resueltas se conservan en
`licenses/fonts/`, y también figuran en el inventario npm. No se descargan fuentes
desde un CDN al iniciar la aplicación.

| Paquete y procedencia                                                                   | Versión | Licencia | Aviso completo                                    |
| --------------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------- |
| [@fontsource/atkinson-hyperlegible](https://fontsource.org/fonts/atkinson-hyperlegible) | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/atkinson-hyperlegible.txt) |
| [@fontsource/cascadia-code](https://fontsource.org/fonts/cascadia-code)                 | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/cascadia-code.txt)         |
| [@fontsource/fira-code](https://fontsource.org/fonts/fira-code)                         | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/fira-code.txt)             |
| [@fontsource/ibm-plex-mono](https://fontsource.org/fonts/ibm-plex-mono)                 | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/ibm-plex-mono.txt)         |
| [@fontsource/ibm-plex-sans](https://fontsource.org/fonts/ibm-plex-sans)                 | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/ibm-plex-sans.txt)         |
| [@fontsource/inter](https://fontsource.org/fonts/inter)                                 | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/inter.txt)                 |
| [@fontsource/jetbrains-mono](https://fontsource.org/fonts/jetbrains-mono)               | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/jetbrains-mono.txt)        |
| [@fontsource/source-sans-3](https://fontsource.org/fonts/source-sans-3)                 | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/source-sans-3.txt)         |
| [@fontsource/space-grotesk](https://fontsource.org/fonts/space-grotesk)                 | 5.3.0   | OFL-1.1  | [Texto](licenses/fonts/space-grotesk.txt)         |

Los paquetes Cascadia Code y Source Sans 3 contienen una atribución genérica.
Se añaden los titulares y nombres reservados indicados por las fuentes primarias:
[Microsoft para Cascadia Code](https://github.com/microsoft/cascadia-code/blob/main/LICENSE)
y [Adobe en Google Fonts para Source Sans 3](https://github.com/google/fonts/blob/main/ofl/sourcesans3/OFL.txt).
Los avisos complementarios están en
[upstream-attributions.txt](licenses/fonts/upstream-attributions.txt); los textos
recibidos de los paquetes no se modificaron.

## Código externo

- [Inventario npm de producción](licenses/npm.md): paquetes resueltos sin marca
  `dev`, versión, declaración de licencia y textos presentes en el paquete.
- [Inventario Cargo](licenses/cargo.md): todas las dependencias externas resueltas,
  incluidas otras plataformas y herramientas de construcción.
- [Manifiesto de textos](licenses/manifest.json): archivos originales copiados,
  paquete, versión y SHA-256 para verificar su conservación.

Los directorios `licenses/npm/` y `licenses/cargo/` contienen los avisos originales
de los paquetes y los recuperados de sus repositorios. El manifiesto identifica
URL, revisión y SHA-256 de los avisos añadidos. Los bytes copiados no se modifican.

Los 48 paquetes Cargo que no incluían textos locales tienen ahora avisos
complementarios. En `objc2` y sus crates relacionados se conserva la explicación
original, la metadata de autores del paquete y el texto canónico MIT de SPDX.
En `r-efi`, el archivo original `AUTHORS` incluye la concesión MIT y la autoría.
En `selectors` se conserva el aviso MPL original junto al texto canónico MPL-2.0;
su código fuente sin modificaciones está disponible en
[la versión 0.36.1](https://crates.io/crates/selectors/0.36.1) y en
[su revisión upstream](https://github.com/servo/stylo/tree/635e1a19d02960588a00e189bd4bd5bdb150ec3d/selectors).

`tao-macros` y `rustls-platform-verifier-android` no registraban un commit de
origen en el paquete: se verificó su versión en los manifiestos del repositorio
correspondiente. Los paquetes binarios `winapi-*-pc-windows-gnu` conservan los
avisos del proyecto winapi en la revisión de la dependencia `winapi` 0.3.9.
Estas procedencias se distinguen en el inventario; no se presentan como archivos
incluidos originalmente dentro de esos paquetes.

Las alternativas de licencia siguen declaradas en cada inventario. Los textos
canónicos son complementos identificados, sin titulares inventados ni cambios
en la licencia del código propio.

## Alcance y mantenimiento

Este conjunto documenta las dependencias resueltas y conserva sus avisos y términos.
No afirma que cada paquete del lockfile esté enlazado en todos los binarios.
GitHub Actions verifica que cada dependencia Cargo y cada paquete npm de producción
tenga avisos registrados y que sus textos coincidan con el SHA-256 del manifiesto.

Las bibliotecas y herramientas del sistema mantienen sus propias licencias. Antes
de distribuir un AppImage u otro paquete que incorpore bibliotecas adicionales,
revisar su contenido real y añadir los avisos de esas bibliotecas. Instalar Git o
usar una biblioteca del sistema no convierte automáticamente su código fuente en
parte de este repositorio.

El workflow de release extrae el AppImage generado y adjunta un archivo
`GitThul_VERSION_linux-x64-system-notices.tar.gz` con un inventario de bibliotecas,
los avisos de los paquetes del sistema de construcción y enlaces a sus fuentes.
Las bibliotecas sin correspondencia se señalan para revisión. Ese inventario no
cubre automáticamente todos los ejecutables ni componentes estáticos: revisar
sus avisos y la disponibilidad de fuentes correspondientes antes de publicar.

Actualizar estos inventarios al cambiar lockfiles, fuentes o recursos distribuidos,
y conservar los avisos correspondientes dentro de los paquetes locales. El nombre
y logotipo del proyecto tienen su política separada en [TRADEMARKS](TRADEMARKS.md).
