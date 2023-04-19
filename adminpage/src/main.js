import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ToastPlugin from 'vue-toast-notification';
import 'vue-toast-notification/dist/theme-default.css';

const app = createApp(App)

app.use(createPinia())
app.use(ToastPlugin);

app.mount('#app')
