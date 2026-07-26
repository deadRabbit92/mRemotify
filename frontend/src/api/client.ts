import axios, { AxiosError } from 'axios';
import { message } from 'antd';
import { useStore } from '../store';
import { Connection, ConnectionFormValues, Folder, Profile, ProfileFormValues, User } from '../types';

const api = axios.create({ baseURL: '/api', timeout: 30000 });

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// These endpoints answer 401 for their own reasons — wrong credentials, wrong
// current password — which the pages report inline. Only a 401 from anywhere
// else means the session itself is gone.
const OWN_401 = ['/auth/login', '/auth/change-password'];

// An expired or invalid token drops the app back to the login page instead of
// leaving it half-loaded behind a "failed to load" toast.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    if (error.response?.status === 401 && !OWN_401.some((path) => url.startsWith(path))) {
      // Only the first failure of a burst still sees a token, so parallel
      // requests can't stack up duplicate warnings.
      if (useStore.getState().token) {
        message.warning('Your session has expired. Please sign in again.');
        useStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const apiLogin = (username: string, password: string) =>
  api.post<{ token: string; user: User }>('/auth/login', { username, password });

export const apiMe = () => api.get<User>('/auth/me');

export const apiChangePassword = (oldPassword: string, newPassword: string) =>
  api.post<{ message: string }>('/auth/change-password', { oldPassword, newPassword });

// Folders
export const apiFolderList = () => api.get<Folder[]>('/folders');
export const apiFolderCreate = (data: { name: string; parentId?: string | null }) =>
  api.post<Folder>('/folders', data);
export const apiFolderUpdate = (id: string, data: { name?: string; parentId?: string | null; sshProfileId?: string | null; rdpProfileId?: string | null }) =>
  api.patch<Folder>(`/folders/${id}`, data);
export const apiFolderDelete = (id: string) => api.delete(`/folders/${id}`);

// Connections
export const apiConnectionList = () => api.get<Connection[]>('/connections');
export const apiConnectionGet = (id: string) => api.get<Connection>(`/connections/${id}`);
export const apiConnectionCreate = (data: ConnectionFormValues) =>
  api.post<Connection>('/connections', data);
export const apiConnectionUpdate = (id: string, data: Partial<ConnectionFormValues>) =>
  api.patch<Connection>(`/connections/${id}`, data);
export const apiConnectionDelete = (id: string) => api.delete(`/connections/${id}`);

// Profiles
export const apiProfileList = () => api.get<Profile[]>('/profiles');
export const apiProfileCreate = (data: ProfileFormValues) =>
  api.post<Profile>('/profiles', data);
export const apiProfileUpdate = (id: string, data: Partial<ProfileFormValues>) =>
  api.patch<Profile>(`/profiles/${id}`, data);
export const apiProfileDelete = (id: string) => api.delete(`/profiles/${id}`);

export default api;
