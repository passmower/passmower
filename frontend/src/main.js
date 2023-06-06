import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ToastPlugin from 'vue-toast-notification';
import 'vue-toast-notification/dist/theme-default.css';
import Admin from "./Admin.vue";
import {createRouter, createWebHistory} from 'vue-router'
import App from "./App.vue";
import Apps from "./Apps.vue";
import Profile from "./Profile.vue";

const app = createApp(App)

const routes = [
    { path: '/', component: Apps },
    { path: '/profile', component: Profile },
    { path: '/admin', component: Admin },
]
const router = createRouter({
    history: createWebHistory(),
    routes,
})
app.use(router)

app.use(createPinia())
app.use(ToastPlugin);

app.mount('#app')
