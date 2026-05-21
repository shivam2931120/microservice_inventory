import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { authApi, extractApiError, type LoginResponse } from '../services/api';
import type { Role, User } from '../types/api';

interface AuthState {
  token: string | null;
  user: User | null;
  status: 'idle' | 'checking' | 'loading' | 'authenticated' | 'error';
  error?: string;
}

function clearStoredSession() {
  localStorage.removeItem('inventory_token');
  localStorage.removeItem('inventory_user');
}

function readStoredSession(): Pick<AuthState, 'token' | 'user'> {
  const token = localStorage.getItem('inventory_token');
  const storedUser = localStorage.getItem('inventory_user');
  if (!token) return { token: null, user: null };
  if (!storedUser) return { token, user: null };
  try {
    return { token, user: JSON.parse(storedUser) as User };
  } catch {
    clearStoredSession();
    return { token: null, user: null };
  }
}

const storedSession = readStoredSession();

const initialState: AuthState = {
  token: storedSession.token,
  user: storedSession.user,
  status: storedSession.token ? 'checking' : 'idle',
};

type AuthThunkConfig = { rejectValue: string };

export const login = createAsyncThunk<
  LoginResponse,
  { username: string; password: string },
  AuthThunkConfig
>('auth/login', async (payload, { rejectWithValue }) => {
  try {
    return await authApi.login(payload.username, payload.password);
  } catch (error) {
    return rejectWithValue(extractApiError(error));
  }
});

export const register = createAsyncThunk<
  { user: User },
  { username: string; password: string; role: Role },
  AuthThunkConfig
>('auth/register', async (payload, { rejectWithValue }) => {
  try {
    return await authApi.register(payload.username, payload.password, payload.role);
  } catch (error) {
    return rejectWithValue(extractApiError(error));
  }
});

export const validateSession = createAsyncThunk<{ user: User }, void, AuthThunkConfig>(
  'auth/validateSession',
  async (_payload, { rejectWithValue }) => {
    try {
      return await authApi.me();
    } catch (error) {
      return rejectWithValue(extractApiError(error));
    }
  },
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.token = null;
      state.user = null;
      state.status = 'idle';
      state.error = undefined;
      clearStoredSession();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.status = 'authenticated';
        state.token = action.payload.token;
        state.user = action.payload.user;
        state.error = undefined;
        localStorage.setItem('inventory_token', action.payload.token);
        localStorage.setItem('inventory_user', JSON.stringify(action.payload.user));
      })
      .addCase(login.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.payload ?? action.error.message;
      })
      .addCase(validateSession.pending, (state) => {
        state.status = 'checking';
        state.error = undefined;
      })
      .addCase(validateSession.fulfilled, (state, action) => {
        state.status = 'authenticated';
        state.user = action.payload.user;
        state.error = undefined;
        localStorage.setItem('inventory_user', JSON.stringify(action.payload.user));
      })
      .addCase(validateSession.rejected, (state, action) => {
        state.token = null;
        state.user = null;
        state.status = 'idle';
        state.error = action.payload ?? action.error.message;
        clearStoredSession();
      })
      .addCase(register.fulfilled, (_state, _action: PayloadAction<{ user: User }>) => undefined);
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
