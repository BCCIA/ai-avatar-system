'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users, Camera, MessageCircle, Activity, ShieldCheck, ShieldOff,
  UserCheck, UserX, Trash2, Loader2, Square,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { api } from '@/lib/api'
import { useStore } from '@/store/useStore'

interface AdminStats {
  users_total: number
  users_active: number
  avatars_total: number
  sessions_total: number
  sessions_active: number
  messages_total: number
}

interface AdminUser {
  id: string
  email: string
  username: string
  full_name?: string | null
  is_active: boolean
  is_superuser: boolean
  created_at: string
}

interface AdminAvatar {
  id: string
  user_id: string
  name: string
  status: string
  created_at?: string
}

interface AdminSession {
  id: string
  user_id: string
  avatar_id: string
  status: string
  started_at: string
  ended_at?: string | null
}

type Tab = 'overview' | 'users' | 'avatars' | 'sessions'

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'avatars', label: 'Avatars', icon: Camera },
  { id: 'sessions', label: 'Sessions', icon: MessageCircle },
]

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-3xl font-black gradient-text">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  )
}

export function AdminPanel() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: api.getAdminStats,
    refetchOnWindowFocus: false,
  })

  const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: api.adminListUsers,
    enabled: tab === 'users',
    refetchOnWindowFocus: false,
  })

  const { data: avatars, isLoading: avatarsLoading } = useQuery<AdminAvatar[]>({
    queryKey: ['admin', 'avatars'],
    queryFn: api.adminListAvatars,
    enabled: tab === 'avatars',
    refetchOnWindowFocus: false,
  })

  const { data: sessions, isLoading: sessionsLoading } = useQuery<AdminSession[]>({
    queryKey: ['admin', 'sessions'],
    queryFn: api.adminListSessions,
    enabled: tab === 'sessions',
    refetchOnWindowFocus: false,
  })

  const toggleUserFlag = async (u: AdminUser, field: 'is_active' | 'is_superuser') => {
    setBusyId(u.id)
    try {
      await api.adminUpdateUser(u.id, { [field]: !u[field] })
      toast.success('User updated')
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast.error(detail || 'Could not update user')
    } finally {
      setBusyId(null)
    }
  }

  const deleteAvatar = async (avatarId: string) => {
    if (!window.confirm('Delete this avatar? This cannot be undone.')) return
    setBusyId(avatarId)
    try {
      await api.deleteAvatar(avatarId)
      toast.success('Avatar deleted')
      queryClient.invalidateQueries({ queryKey: ['admin', 'avatars'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
    } catch {
      toast.error('Could not delete avatar')
    } finally {
      setBusyId(null)
    }
  }

  const endSession = async (sessionId: string) => {
    setBusyId(sessionId)
    try {
      await api.endSession(sessionId)
      toast.success('Session ended')
      queryClient.invalidateQueries({ queryKey: ['admin', 'sessions'] })
    } catch {
      toast.error('Could not end session')
    } finally {
      setBusyId(null)
    }
  }

  const deleteSession = async (sessionId: string) => {
    if (!window.confirm('Delete this session? This cannot be undone.')) return
    setBusyId(sessionId)
    try {
      await api.deleteSession(sessionId)
      toast.success('Session deleted')
      queryClient.invalidateQueries({ queryKey: ['admin', 'sessions'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] })
    } catch {
      toast.error('Could not delete session')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-black gradient-text mb-2">Admin</h1>
        <p className="text-gray-400">Platform-wide users, avatars, and sessions.</p>
      </div>

      <div className="flex items-center gap-1 p-1 mb-6 rounded-xl bg-surface-800/80 border border-white/8 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
              ${tab === id
                ? 'bg-gradient-to-r from-primary-600/80 to-accent-600/80 text-white shadow-glow-sm'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        statsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Total users" value={stats.users_total} />
            <StatCard label="Active users" value={stats.users_active} />
            <StatCard label="Avatars" value={stats.avatars_total} />
            <StatCard label="Sessions" value={stats.sessions_total} />
            <StatCard label="Active sessions" value={stats.sessions_active} />
            <StatCard label="Messages" value={stats.messages_total} />
          </div>
        ) : (
          <p className="text-gray-500">Could not load stats.</p>
        )
      )}

      {tab === 'users' && (
        usersLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : (
          <div className="space-y-2">
            {(users || []).map((u) => (
              <div key={u.id} className="glass-card rounded-xl px-5 py-3 flex items-center gap-4 border border-white/8">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white truncate">{u.username}</span>
                    <span className="text-xs text-gray-500">{u.email}</span>
                    {u.is_superuser && <span className="badge badge-amber text-xs">admin</span>}
                    {!u.is_active && <span className="badge badge-gray text-xs">disabled</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleUserFlag(u, 'is_active')}
                    className="btn-icon"
                    title={u.is_active ? 'Deactivate user' : 'Activate user'}
                    disabled={busyId === u.id || u.id === currentUser?.id}
                  >
                    {u.is_active ? <UserX size={13} /> : <UserCheck size={13} />}
                  </button>
                  <button
                    onClick={() => toggleUserFlag(u, 'is_superuser')}
                    className="btn-icon"
                    title={u.is_superuser ? 'Revoke admin' : 'Grant admin'}
                    disabled={busyId === u.id || u.id === currentUser?.id}
                  >
                    {u.is_superuser ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                  </button>
                </div>
              </div>
            ))}
            {users && users.length === 0 && <p className="text-gray-500 text-sm">No users.</p>}
          </div>
        )
      )}

      {tab === 'avatars' && (
        avatarsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : (
          <div className="space-y-2">
            {(avatars || []).map((a) => (
              <div key={a.id} className="glass-card rounded-xl px-5 py-3 flex items-center gap-4 border border-white/8">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white truncate">{a.name}</span>
                    <span className="badge badge-gray text-xs">{a.status}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 font-mono">owner: {a.user_id.slice(0, 8)}</div>
                </div>
                <button
                  onClick={() => deleteAvatar(a.id)}
                  className="btn-icon text-gray-500 hover:text-red-400"
                  title="Delete avatar"
                  disabled={busyId === a.id}
                >
                  {busyId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            ))}
            {avatars && avatars.length === 0 && <p className="text-gray-500 text-sm">No avatars.</p>}
          </div>
        )
      )}

      {tab === 'sessions' && (
        sessionsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : (
          <div className="space-y-2">
            {(sessions || []).map((s) => (
              <div key={s.id} className="glass-card rounded-xl px-5 py-3 flex items-center gap-4 border border-white/8">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-white">{s.id.slice(0, 8)}</span>
                    <span className={`badge text-xs ${
                      s.status === 'active' ? 'badge-green' :
                      s.status === 'paused' ? 'badge-amber' : 'badge-gray'
                    }`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 font-mono">owner: {s.user_id.slice(0, 8)}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {s.status === 'active' && (
                    <button
                      onClick={() => endSession(s.id)}
                      className="btn-icon"
                      title="End session"
                      disabled={busyId === s.id}
                    >
                      <Square size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteSession(s.id)}
                    className="btn-icon text-gray-500 hover:text-red-400"
                    title="Delete session"
                    disabled={busyId === s.id}
                  >
                    {busyId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            ))}
            {sessions && sessions.length === 0 && <p className="text-gray-500 text-sm">No sessions.</p>}
          </div>
        )
      )}
    </div>
  )
}
