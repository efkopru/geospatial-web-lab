# Third-party notices

This standalone suite uses the software listed below. The accompanying files preserve the license and notice text supplied with the installed packages, except for JSTS license files obtained from its official matching release tag. Package versions come from this edition's installed dependency tree.

These copies form a notice collection for the five-app suite. The same collection accompanies each app's static build, so it can include notices for libraries or vendor sample assets that a particular app does not use. The collection does not assign those libraries' licenses to this application's own source code.

## Direct runtime dependencies

| Package | Installed version | Package license declaration | Preserved text |
|---|---|---|---|
| React | 19.3.0 | MIT | [React license](licenses/react-LICENSE.txt) |
| React DOM | 19.3.0 | MIT | [React DOM license](licenses/react-dom-LICENSE.txt) |
| ArcGIS Maps SDK for JavaScript, `@arcgis/core` | 5.1.26 | `SEE LICENSE IN LICENSE.md` | [Esri package license](licenses/arcgis-core-LICENSE.md), [package third-party notices](licenses/arcgis-core-third-party-notices.txt) |
| CesiumJS, `cesium` | 1.145.0 | Apache-2.0 | [Cesium license and bundled notices](licenses/cesium-LICENSE.md) |
| JSTS | 2.12.1 | `(EDL-1.0 OR EPL-1.0)` | [EDL 1.0](licenses/jsts-LICENSE_EDLv1.txt), [EPL 1.0](licenses/jsts-LICENSE_EPLv1.txt), [upstream license banner](licenses/jsts-license.txt) |

The ArcGIS package license refers to the [Esri Master License Agreement](https://www.esri.com/content/dam/esrisites/en-us/media/legal/ma-full/ma-full.pdf). Its copyright notice is preserved unchanged. Basemap and hosted-service use remains subject to the applicable provider terms; these application notice files do not replace those terms. Existing map attribution and Cesium credits are retained in the interfaces.

The JSTS npm package installed for this edition contains a license declaration but omits the corresponding license text files. The copies here were retrieved from the official [`2.12.1` source tag](https://github.com/bjornharrtell/jsts/tree/2.12.1): [LICENSE_EDLv1.txt](https://raw.githubusercontent.com/bjornharrtell/jsts/2.12.1/LICENSE_EDLv1.txt), [LICENSE_EPLv1.txt](https://raw.githubusercontent.com/bjornharrtell/jsts/2.12.1/LICENSE_EPLv1.txt), and [license.txt](https://raw.githubusercontent.com/bjornharrtell/jsts/2.12.1/license.txt). Both alternatives are preserved as supplied; the declaration is recorded verbatim.

## Additional preserved runtime notices

| Package | Installed version | Package license declaration | Preserved text |
|---|---|---|---|
| `scheduler` | 0.28.0 | MIT | [React scheduler license](licenses/react-scheduler-LICENSE.txt) |
| `@cesium/engine` | 26.3.0 | Apache-2.0 | [Cesium engine license and notices](licenses/cesium-engine-LICENSE.md) |
| `@cesium/widgets` | 16.2.0 | Apache-2.0 | [Cesium widgets license and notices](licenses/cesium-widgets-LICENSE.md) |
| `fastpriorityqueue` | 0.7.5 | Apache-2.0 | [FastPriorityQueue license](licenses/fastpriorityqueue-LICENSE.txt) |

Vendor notice files are retained in full, including their component-specific attribution. This collection records the identified runtime packages and their supplied notice bundles; it is not a claim that every item in the development dependency tree ships in every browser build.

## Provenance and distribution

[`licenses/SOURCES.json`](licenses/SOURCES.json) records the source package paths or pinned release URLs and SHA-256 digest of each preserved file. Local package copies were copied byte for byte. The JSTS source files were downloaded without rewriting their text. No vendor library source was edited for the standalone conversion.

The Vite configuration serves these files alongside each development app and copies them into each app's static output. The launcher also includes them at the root of the combined static gallery. Keep the notice document and `licenses` directory together when copying or deploying those outputs.
