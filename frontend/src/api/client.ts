import axios from 'axios';
import { Connection, ConnectionFormValues, Folder, Profile, ProfileFormValues, User } from '../types';

const api = axios.create({ baseURL: '/api', timeout: 30000 });

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

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
