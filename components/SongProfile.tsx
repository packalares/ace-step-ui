import React, { useState, useEffect } from 'react';
import { Song } from '../types';
import { songsApi, getAudioUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { ArrowLeft, Play, Pause, Heart, Share2, MoreHorizontal, ThumbsDown, Music as MusicIcon, Edit3, Eye } from 'lucide-react';
import { ShareModal } from './ShareModal';
import { SongDropdownMenu } from './SongDropdownMenu';
import { Button, IconButton, Badge } from './ui';

interface SongProfileProps {
    songId: string;
    onBack: () => void;
    onPlay: (song: Song, list?: Song[]) => void;
    onNavigateToProfile: (username: string) => void;
    currentSong?: Song | null;
    isPlaying?: boolean;
    likedSongIds?: Set<string>;
    onToggleLike?: (songId: string) => void;
    onDelete?: (song: Song) => void;
}

const updateMetaTags = (song: Song) => {
    const baseUrl = window.location.origin;
    const songUrl = `${baseUrl}/song/${song.id}`;
    const title = `${song.title} by ${song.creator || 'Unknown Artist'} | ACE-Step UI`;
    const description = `Listen to "${song.title}" - ${song.style}. ${song.viewCount || 0} plays, ${song.likeCount || 0} likes. Create your own AI music with ACE-Step UI.`;

    document.title = title;

    const updateOrCreateMeta = (selector: string, attribute: string, value: string) => {
        let element = document.querySelector(selector) as HTMLMetaElement;
        if (!element) {
            element = document.createElement('meta');
            const [attr, attrValue] = selector.replace(/[\[\]'"]/g, '').split('=');
            if (attr === 'property') element.setAttribute('property', attrValue);
            else if (attr === 'name') element.setAttribute('name', attrValue);
            document.head.appendChild(element);
        }
        element.setAttribute(attribute, value);
    };

    updateOrCreateMeta('meta[name="description"]', 'content', description);
    updateOrCreateMeta('meta[name="title"]', 'content', title);

    updateOrCreateMeta('meta[property="og:type"]', 'content', 'music.song');
    updateOrCreateMeta('meta[property="og:url"]', 'content', songUrl);
    updateOrCreateMeta('meta[property="og:title"]', 'content', title);
    updateOrCreateMeta('meta[property="og:description"]', 'content', description);
    updateOrCreateMeta('meta[property="og:image"]', 'content', song.coverUrl);
    updateOrCreateMeta('meta[property="og:image:width"]', 'content', '400');
    updateOrCreateMeta('meta[property="og:image:height"]', 'content', '400');
    updateOrCreateMeta('meta[property="og:audio"]', 'content', song.audioUrl || '');
    updateOrCreateMeta('meta[property="og:audio:type"]', 'content', 'audio/mpeg');

    updateOrCreateMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    updateOrCreateMeta('meta[name="twitter:url"]', 'content', songUrl);
    updateOrCreateMeta('meta[name="twitter:title"]', 'content', title);
    updateOrCreateMeta('meta[name="twitter:description"]', 'content', description);
    updateOrCreateMeta('meta[name="twitter:image"]', 'content', song.coverUrl);

    updateOrCreateMeta('meta[property="music:duration"]', 'content', String(song.duration || 0));
    updateOrCreateMeta('meta[property="music:musician"]', 'content', song.creator || 'Unknown Artist');
};

const resetMetaTags = () => {
    document.title = 'ACE-Step UI - Local AI Music Generator';
    const defaultDescription = 'Create original music with AI locally. Generate songs in any style with custom lyrics and professional quality using ACE-Step.';
    const defaultImage = '/og-image.png';

    const updateMeta = (selector: string, content: string) => {
        const element = document.querySelector(selector) as HTMLMetaElement;
        if (element) element.setAttribute('content', content);
    };

    updateMeta('meta[name="description"]', defaultDescription);
    updateMeta('meta[property="og:title"]', 'ACE-Step UI - Local AI Music Generator');
    updateMeta('meta[property="og:description"]', defaultDescription);
    updateMeta('meta[property="og:image"]', defaultImage);
    updateMeta('meta[property="og:type"]', 'website');
    updateMeta('meta[name="twitter:title"]', 'ACE-Step UI - Local AI Music Generator');
    updateMeta('meta[name="twitter:description"]', defaultDescription);
    updateMeta('meta[name="twitter:image"]', defaultImage);
};

export const SongProfile: React.FC<SongProfileProps> = ({ songId, onBack, onPlay, onNavigateToProfile, currentSong, isPlaying, likedSongIds = new Set(), onToggleLike, onDelete }) => {
    const { user, token } = useAuth();
    const { t } = useI18n();
    const [song, setSong] = useState<Song | null>(null);
    const [loading, setLoading] = useState(true);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);

    const isCurrentSong = song && currentSong?.id === song.id;
    const isCurrentlyPlaying = isCurrentSong && isPlaying;
    const isLiked = song ? likedSongIds.has(song.id) : false;

    useEffect(() => {
        loadSongData();
        return () => resetMetaTags();
    }, [songId]);

    useEffect(() => {
        if (song) {
            updateMetaTags(song);
        }
    }, [song]);

    const loadSongData = async () => {
        setLoading(true);
        try {
            const response = await songsApi.getFullSong(songId, token);

            const transformedSong: Song = {
                id: response.song.id,
                title: response.song.title,
                lyrics: response.song.lyrics,
                style: response.song.style,
                coverUrl: `https://picsum.photos/seed/${response.song.id}/400/400`,
                duration: response.song.duration
                    ? `${Math.floor(response.song.duration / 60)}:${String(Math.floor(response.song.duration % 60)).padStart(2, '0')}`
                    : '0:00',
                createdAt: new Date(response.song.created_at),
                tags: response.song.tags || [],
                audioUrl: getAudioUrl(response.song.audio_url, response.song.id),
                isPublic: response.song.is_public,
                likeCount: response.song.like_count || 0,
                viewCount: response.song.view_count || 0,
                userId: response.song.user_id,
                creator: response.song.creator,
                creator_avatar: response.song.creator_avatar,
            };

            setSong(transformedSong);
        } catch (error) {
            console.error('Failed to load song:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-zinc-50 dark:bg-black">
                <div className="text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    {t('loadingSong')}
                </div>
            </div>
        );
    }

    if (!song) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 bg-zinc-50 dark:bg-black">
                <div className="text-zinc-500 dark:text-zinc-400">{t('songNotFound')}</div>
                <button onClick={onBack} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-lg text-zinc-900 dark:text-white transition-colors">
                    {t('goBack')}
                </button>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col bg-zinc-50 dark:bg-black overflow-hidden">
            {/* Header */}
            <div className="border-b border-zinc-200 dark:border-zinc-800 px-3 py-2 flex-shrink-0">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white mb-2 transition-colors text-[11px]"
                >
                    <ArrowLeft size={14} />
                    <span>{t('back')}</span>
                </button>

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="flex-1">
                        <h1 className="text-sm font-bold text-zinc-900 dark:text-white mb-1">{song.title}</h1>
                        <div className="flex items-center gap-2 mb-1.5">
                            <div
                                onClick={() => song.creator && onNavigateToProfile(song.creator)}
                                className="flex items-center gap-1.5 cursor-pointer hover:underline"
                            >
                                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[9px] font-bold text-white overflow-hidden">
                                    {song.creator_avatar ? (
                                        <img src={song.creator_avatar} alt={song.creator || 'Creator'} className="w-full h-full object-cover" />
                                    ) : (
                                        song.creator ? song.creator[0].toUpperCase() : 'A'
                                    )}
                                </div>
                                <span className="text-[11px] text-zinc-400">{song.creator || 'Anonymous'}</span>
                            </div>
                        </div>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {song.style.split(',').slice(0, 4).map((tag, i) => (
                                <Badge key={i} variant="default" size="sm">{tag.trim()}</Badge>
                            ))}
                        </div>

                        <div className="text-[10px] text-zinc-500">
                            {new Date(song.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at {new Date(song.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            {!song.isPublic && song.userId === user?.id && (
                                <Badge variant="default" size="sm">Private</Badge>
                            )}
                        </div>
                    </div>

                    {/* Related Songs Tab - Hidden on mobile */}
                    <div className="hidden md:flex items-center gap-1.5">
                        <Button variant="primary" size="sm">Similar</Button>
                        <Button variant="ghost" size="sm" onClick={() => song.creator && onNavigateToProfile(song.creator)}>
                            By {song.creator || 'Artist'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-3 py-3 pb-24 lg:pb-28">

                    {/* Left Column: Song Details */}
                    <div className="space-y-3">
                        {/* Cover Art */}
                        <div className="relative aspect-square max-w-[160px] mx-auto rounded-xl overflow-hidden shadow-xl">
                            <img src={song.coverUrl} alt={song.title} className={`w-full h-full object-cover transition-transform duration-500 ${isCurrentlyPlaying ? 'scale-105' : ''}`} />
                            <button
                                onClick={() => onPlay(song)}
                                className={`absolute inset-0 transition-colors flex items-center justify-center group ${isCurrentSong ? 'bg-black/50' : 'bg-black/40 hover:bg-black/50'}`}
                            >
                                <div className="w-12 h-12 rounded-full bg-white group-hover:scale-110 transition-transform flex items-center justify-center shadow-xl">
                                    {isCurrentlyPlaying ? (
                                        <Pause size={22} className="text-black fill-black" />
                                    ) : (
                                        <Play size={22} className="text-black fill-black ml-0.5" />
                                    )}
                                </div>
                            </button>
                            {isCurrentlyPlaying && (
                                <div className="absolute bottom-3 left-3 flex items-center gap-1">
                                    <span className="w-1 h-3 bg-pink-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1 h-5 bg-pink-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1 h-2.5 bg-pink-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                                    <span className="w-1 h-5 bg-pink-500 rounded-full animate-pulse" style={{ animationDelay: '450ms' }} />
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center justify-center lg:justify-start gap-1 flex-wrap">
                            <div className="flex items-center gap-1 bg-zinc-200 dark:bg-zinc-900 px-2 py-1 rounded-full text-[11px]">
                                <Eye size={12} className="text-zinc-600 dark:text-white" />
                                <span className="text-zinc-900 dark:text-white font-semibold">{song.viewCount || 0}</span>
                            </div>
                            <button
                                onClick={() => onToggleLike?.(song.id)}
                                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] transition-colors ${isLiked ? 'bg-pink-500 text-white' : 'bg-zinc-200 dark:bg-zinc-900 hover:bg-zinc-300 dark:hover:bg-zinc-800 text-zinc-900 dark:text-white'}`}
                            >
                                <Heart size={12} className={isLiked ? 'fill-current' : ''} />
                                <span className="font-semibold">{song.likeCount || 0}</span>
                            </button>
                            {user?.id === song.userId && (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => {
                                        if (!song.audioUrl) return;
                                        const audioUrl = song.audioUrl.startsWith('http') ? song.audioUrl : `${window.location.origin}${song.audioUrl}`;
                                        window.open(`/editor?audioUrl=${encodeURIComponent(audioUrl)}`, '_blank');
                                    }}
                                >
                                    <Edit3 size={12} />
                                    <span className="hidden md:inline">Edit</span>
                                </Button>
                            )}
                            <IconButton
                                icon={<Share2 size={14} />}
                                onClick={() => setShareModalOpen(true)}
                                title="Share"
                            />
                            <div className="relative">
                                <IconButton
                                    icon={<MoreHorizontal size={14} />}
                                    onClick={() => setShowDropdown(!showDropdown)}
                                    title="More"
                                />
                                {song && (
                                    <SongDropdownMenu
                                        song={song}
                                        isOpen={showDropdown}
                                        onClose={() => setShowDropdown(false)}
                                        isOwner={user?.id === song.userId}
                                        onReusePrompt={() => {}}
                                        onAddToPlaylist={() => {}}
                                        onDelete={() => onDelete?.(song)}
                                        onShare={() => setShareModalOpen(true)}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Lyrics */}
                        {song.lyrics && (
                            <div>
                                <h4 className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1.5">Lyrics</h4>
                                <div className="bg-zinc-900/30 rounded-lg p-3">
                                    <div className="text-[11px] text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed font-mono max-h-64 md:max-h-80 overflow-y-auto">
                                        {song.lyrics}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {song && (
                <ShareModal
                    isOpen={shareModalOpen}
                    onClose={() => setShareModalOpen(false)}
                    song={song}
                />
            )}
        </div>
    );
};
