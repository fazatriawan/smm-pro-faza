import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useNotifStore } from '../store';
import toast from 'react-hot-toast';

let socket;

export function useSocket(userId) {
  const addNotification = useNotifStore((s) => s.addNotification);

  useEffect(() => {
    if (!userId) return;
    socket = io(process.env.REACT_APP_WS_URL || 'http://localhost:5000');
    socket.emit('join', userId);

    socket.on('notification:new', (notif) => {
      addNotification(notif);
      const icons = { instagram: '📸', youtube: '▶', facebook: '📘', twitter: '🐦', tiktok: '🎵' };
      toast(`${icons[notif.platform] || '🔔'} ${notif.content?.slice(0, 60)}`, { duration: 4000 });
    });

    socket.on('post:published', ({ postId }) => {
      toast.success(`Post berhasil dikirim!`);
    });

    socket.on('post:failed', ({ postId, error }) => {
      toast.error(`Post gagal: ${error}`);
    });

    return () => { socket?.disconnect(); };
  }, [userId, addNotification]);
}
