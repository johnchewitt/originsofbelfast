/// <reference types="vite/client" />
/// <reference types="@arcgis/map-components/types/react" />
/// <reference types="@esri/calcite-components/types/react" />

interface ImportMetaEnv {
  readonly VITE_ARCGIS_API_KEY?: string;
  readonly VITE_ARCGIS_PORTAL_URL?: string;
  readonly VITE_OSM_BUILDINGS_ITEM_ID?: string;
  readonly VITE_ASSISTANT_ENDPOINT?: string;
  readonly VITE_ARCGIS_LOCAL_ASSETS?: string;
  readonly VITE_HISTORIC_MAP_SERVICES?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
