import { createRouter, createWebHistory } from "vue-router";

import ResultPageV2 from "../pages/ResultPageV2.vue";
import UploadV2Page from "../pages/UploadV2Page.vue";
import ChatPage from "../pages/ChatPage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
import MindMapPage from "../pages/MindMapPage.vue";

const routes = [
  {
    path: "/",
    redirect: "/upload-v2"  // 默认跳转到 V2 上传页
  },
  {
    path: "/upload-v2",
    name: "uploadV2",
    component: UploadV2Page
  },
  {
    path: "/result-v2/:id?",
    name: "resultV2",
    component: ResultPageV2
  },
  {
    path: "/chat/:id",
    name: "chat",
    component: ChatPage
  },
  {
    path: "/settings",
    name: "settings",
    component: SettingsPage
  },
  {
    path: "/mindmap/:id",
    name: "mindmap",
    component: MindMapPage
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
