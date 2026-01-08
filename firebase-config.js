
// Firebase Config - Replace with your own keys if needed
const firebaseConfig = {
    apiKey: "AIzaSyAn9dxHx7p1bQKwo5ZCxXfXZb5H1URWDy4",
    authDomain: "vibe-quiz-2a740.firebaseapp.com",
    databaseURL: "https://vibe-quiz-2a740-default-rtdb.firebaseio.com",
    projectId: "vibe-quiz-2a740",
    storageBucket: "vibe-quiz-2a740.firebasestorage.app",
    messagingSenderId: "74404702598",
    appId: "1:74404702598:web:c107efa3d8b14c5f42a407",
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
} catch (e) { console.error("Firebase Init Error:", e); }

const db = firebase.database();

// ★★★ UUID生成・取得ユーティリティ ★★★
function getOrCreateUserId() {
    let userId = localStorage.getItem('vibeQuizUserId');
    if (!userId) {
        // crypto.randomUUID()が使えない場合のフォールバック
        userId = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        localStorage.setItem('vibeQuizUserId', userId);
    }
    return userId;
}

// Global VibeQuiz Object
window.VibeQuiz = {
    db: db,
    getUserId: getOrCreateUserId,

    // --- Room V3 Logic ---

    // Create a new room
    createRoom: async (hostName, settings, customId) => {
        let roomId;

        if (customId) {
            roomId = customId.toUpperCase();
            // Allow overwriting existing rooms (reuse IDs)
        } else {
            // Generate Random
            roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        const roomRef = db.ref(`rooms/${roomId}`);

        await roomRef.set({
            hostName: hostName,
            hostUUID: getOrCreateUserId(),  // ★ ホストのUUIDを保存 ★
            status: 'waiting',
            settings: {
                maxQuestions: parseInt(settings.maxQuestions) || 10,
                playlistIds: settings.playlistIds || [settings.playlistId || 'global'],
                handicapMode: settings.handicapMode || false,
                correctPoints: parseInt(settings.correctPoints) || 1,
                wrongPoints: parseInt(settings.wrongPoints) || 0,
                playDuration: parseInt(settings.playDuration) || 30,
                answerTime: parseInt(settings.answerTime) || 15,
                // ★ 新機能 ★
                soloMode: settings.soloMode || false
            },
            // ★ 部屋情報 ★
            roomName: settings.roomName || `${hostName}の部屋`,
            visibility: settings.visibility || 'private',
            password: settings.password || null,
            createdAt: Date.now(),
            questionCount: 0,
            users: {}
        });
        return roomId;
    },

    // Update room settings (Host only)
    updateRoomSettings: async (roomId, newSettings) => {
        const updates = {};

        if (newSettings.maxQuestions !== undefined) {
            updates['settings/maxQuestions'] = parseInt(newSettings.maxQuestions);
        }
        if (newSettings.playlistIds !== undefined) {
            updates['settings/playlistIds'] = newSettings.playlistIds;
        }
        if (newSettings.handicapMode !== undefined) {
            updates['settings/handicapMode'] = newSettings.handicapMode;
        }
        if (newSettings.correctPoints !== undefined) {
            updates['settings/correctPoints'] = parseInt(newSettings.correctPoints);
        }
        if (newSettings.wrongPoints !== undefined) {
            updates['settings/wrongPoints'] = parseInt(newSettings.wrongPoints);
        }
        if (newSettings.playDuration !== undefined) {
            updates['settings/playDuration'] = parseInt(newSettings.playDuration);
        }
        if (newSettings.answerTime !== undefined) {
            updates['settings/answerTime'] = parseInt(newSettings.answerTime);
        }
        if (newSettings.handicapBonus !== undefined) {
            updates['settings/handicapBonus'] = parseInt(newSettings.handicapBonus);
        }
        if (newSettings.handicapPenalty !== undefined) {
            updates['settings/handicapPenalty'] = parseInt(newSettings.handicapPenalty);
        }

        await db.ref(`rooms/${roomId}`).update(updates);
    },

    // Get available playlists (for settings UI)
    getPlaylists: async () => {
        const snap = await db.ref('playlists').once('value');
        const data = snap.val() || {};
        return Object.entries(data).map(([id, val]) => ({
            id: id,
            name: val.name,
            isPrivate: val.isPrivate || false,
            ownerUUID: val.ownerUUID || null
        }));
    },

    // ★★★ 公開部屋一覧を取得 ★★★
    getPublicRooms: async () => {
        try {
            const snap = await db.ref('rooms').once('value');
            const data = snap.val() || {};

            // 6時間以上前に作成された部屋は除外
            const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);

            return Object.entries(data)
                .filter(([id, room]) => {
                    if (!room) return false;
                    if (room.visibility !== 'public') return false;
                    if (room.status === 'completed') return false;
                    if ((room.createdAt || 0) < sixHoursAgo) return false;
                    // ★ 0人参加の部屋は除外 ★
                    const userCount = room.users ? Object.keys(room.users).length : 0;
                    if (userCount === 0) return false;
                    return true;
                })
                .map(([roomId, room]) => ({
                    roomId: roomId,
                    roomName: room.roomName || `${room.hostName || '???'}の部屋`,
                    hostName: room.hostName || '???',
                    status: room.status || 'waiting',
                    userCount: room.users ? Object.keys(room.users).length : 0
                }));
        } catch (e) {
            console.error('getPublicRooms error:', e);
            return [];
        }
    },

    // Join a room
    joinRoom: async (roomId, username) => {
        if (!roomId) throw new Error("Room ID is missing");
        const roomRef = db.ref(`rooms/${roomId}`);
        const snap = await roomRef.once('value');
        if (!snap.exists()) throw new Error("部屋が見つかりません！");

        const roomData = snap.val();

        // Check if room is stale (created more than 6 hours ago with no users)
        const createdAt = roomData.createdAt || 0;
        const users = roomData.users || {};
        const userCount = Object.keys(users).length;
        const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);

        if (createdAt < sixHoursAgo && userCount === 0) {
            // Clean up stale room
            await roomRef.remove();
            throw new Error("この部屋は期限切れです。新しい部屋を作成してください。");
        }

        // Check if game is in progress
        const status = roomData.status || 'waiting';
        const isSpectator = status !== 'waiting' && status !== 'completed';

        if (isSpectator) {
            // ★ 観戦者として参加 ★
            const spectatorRef = roomRef.child(`spectators`).push();
            await spectatorRef.set({
                name: username,
                joinedAt: Date.now()
            });
            return { isSpectator: true };
        }

        const userRef = roomRef.child(`users`).push();
        const userUUID = getOrCreateUserId();
        await userRef.set({
            name: username,
            uuid: userUUID,  // ★ UUIDを保存 ★
            score: 0,
            online: true,
            joinedAt: Date.now()
        });

        // ★★★ グローバル統計のdisplayNameを更新（ニックネーム変更対応） ★★★
        try {
            const userId = getOrCreateUserId();
            const userStatsRef = db.ref(`stats/users/${userId}`);
            await userStatsRef.update({
                displayName: username,
                lastActive: Date.now()
            });
        } catch (e) {
            console.error('Stats displayName update error:', e);
        }

        // Remove on disconnect
        userRef.onDisconnect().remove();
        return userRef.key;
    },

    // Game Logic
    nextQuestion: async (roomId) => {
        const roomRef = db.ref(`rooms/${roomId}`);

        // Playlist Logic
        const settingsSnap = await roomRef.child('settings').once('value');
        const settings = settingsSnap.val() || {};

        // Support both new playlistIds array and legacy playlistId string
        let playlistIds = settings.playlistIds || [settings.playlistId || 'global'];
        if (!Array.isArray(playlistIds)) playlistIds = [playlistIds];

        // Fetch Songs from all selected playlists
        let songs = {};

        // Check if yaminabe is included
        if (playlistIds.includes('yaminabe')) {
            // Fetch all songs
            const globalSnap = await db.ref('playlist').once('value');
            songs = { ...(globalSnap.val() || {}) };

            const allSnap = await db.ref('playlists').once('value');
            const allData = allSnap.val() || {};
            Object.values(allData).forEach(pl => {
                if (pl.songs) songs = { ...songs, ...pl.songs };
            });
        } else {
            // Fetch from selected playlists
            for (const plId of playlistIds) {
                if (plId === 'global') {
                    const snap = await db.ref('playlist').once('value');
                    songs = { ...songs, ...(snap.val() || {}) };
                } else {
                    const snap = await db.ref(`playlists/${plId}/songs`).once('value');
                    songs = { ...songs, ...(snap.val() || {}) };
                }
            }
        }

        if (!songs || Object.keys(songs).length === 0) return null;

        const playedSnap = await roomRef.child('played').once('value');
        const played = playedSnap.val() || {};

        const unplayedIds = Object.keys(songs).filter(id => !played[id]);

        const maxQ = parseInt(settings.maxQuestions) || 10;
        const countSnap = await roomRef.child('questionCount').once('value');
        const currentCount = countSnap.val() || 0;

        // End Game?
        if (unplayedIds.length === 0 || currentCount >= maxQ) {
            // ★★★ 順位ポイント付与 ★★★
            const soloMode = settings.soloMode || false;
            if (!soloMode) {
                try {
                    const usersSnap = await roomRef.child('users').once('value');
                    const users = usersSnap.val() || {};
                    const sortedUsers = Object.entries(users)
                        .map(([uid, u]) => ({ uid, ...u }))
                        .sort((a, b) => (b.score || 0) - (a.score || 0));

                    // 順位ポイント配分: 1位=10pt, 2位=5pt, 3位=2pt
                    const rankPointsMap = { 1: 10, 2: 5, 3: 2 };

                    let currentRank = 1;
                    let prevScore = null;
                    for (let i = 0; i < sortedUsers.length; i++) {
                        const u = sortedUsers[i];
                        // 同率順位の計算
                        if (prevScore !== null && u.score !== prevScore) {
                            currentRank = i + 1;
                        }
                        prevScore = u.score;

                        const points = rankPointsMap[currentRank] || 0;
                        if (points > 0) {
                            // グローバル統計に順位ポイントを加算
                            // UUIDがある場合はそれで、ない場合は名前で検索
                            const statsSnap = await db.ref('stats/users').orderByChild('displayName').equalTo(u.name).once('value');
                            if (statsSnap.exists()) {
                                const statsKey = Object.keys(statsSnap.val())[0];
                                await db.ref(`stats/users/${statsKey}/rankPoints`).transaction(v => (v || 0) + points);

                                // ★ 週間ポイントも加算（月曜0時でリセット）★
                                const now = new Date();
                                const dayOfWeek = now.getDay();
                                const weekStart = new Date(now);
                                weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
                                weekStart.setHours(0, 0, 0, 0);
                                const weekStartTime = weekStart.getTime();

                                const statsData = statsSnap.val()[statsKey];
                                if ((statsData.weekStart || 0) < weekStartTime) {
                                    // 新しい週なのでリセット
                                    await db.ref(`stats/users/${statsKey}`).update({
                                        weeklyRankPoints: points,
                                        weekStart: weekStartTime
                                    });
                                } else {
                                    await db.ref(`stats/users/${statsKey}/weeklyRankPoints`).transaction(v => (v || 0) + points);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Rank points award error:', e);
                }
            }

            await roomRef.update({ status: 'completed' });
            return null;
        }

        const nextId = unplayedIds[Math.floor(Math.random() * unplayedIds.length)];
        const nextSong = songs[nextId];

        await roomRef.update({
            currentSongId: nextId,
            currentSongAddedBy: nextSong.addedBy || null,
            currentSongAddedByUUID: nextSong.addedByUUID || null,  // UUIDも保存
            status: 'playing',
            buzzerUser: null,
            seekTo: 0,
            questionCount: currentCount + 1,
            wrongAnswers: null,
            buzzTimes: null,  // ★ buzzTimesをクリア ★
            playStartTime: firebase.database.ServerValue.TIMESTAMP, // ★ 曲開始時刻 ★
            startTime: firebase.database.ServerValue.TIMESTAMP, // Server timestamp for sync
            message: {
                text: `第${currentCount + 1}問！スタート！`,
                type: "info",
                timestamp: firebase.database.ServerValue.TIMESTAMP
            }
        });
        return nextId;
    },

    buzz: async (roomId, username, userId, buzzTime) => {
        const roomRef = db.ref(`rooms/${roomId}`);

        // ★ サーバー時刻を記録（端末間のバッファリング差を解消）★
        await roomRef.child(`buzzTimes/${userId}`).set({
            username: username,
            localTime: buzzTime,  // 表示用（端末での再生位置）
            serverTimestamp: firebase.database.ServerValue.TIMESTAMP  // 判定用（サーバー時刻）
        });

        // トランザクションで最速押下者を判定
        return roomRef.transaction((room) => {
            if (room && room.status === 'playing') {
                // wrongAnswersチェック
                if (room.wrongAnswers && room.wrongAnswers[userId]) return room;

                // buzzTimesから最速押下者を判定（曲開始からの経過時間ベース）
                const buzzTimes = room.buzzTimes || {};
                const settings = room.settings || {};
                const handicapMode = settings.handicapMode || false;
                const handicapDelay = settings.handicapDelay || 0;
                const songAddedByUUID = room.currentSongAddedByUUID || null;

                let fastestUser = null;
                let fastestUserId = null;
                let fastestTime = Infinity;

                for (const [uid, data] of Object.entries(buzzTimes)) {
                    // wrongAnswersに登録されているユーザーは除外
                    if (room.wrongAnswers && room.wrongAnswers[uid]) continue;
                    // ★ localTime（曲開始からの経過時間）で判定 ★
                    let buzzTime = data.localTime !== undefined ? data.localTime : (data.time || Infinity);

                    // ★ ハンデ遅延：追加者の場合は遅延を加算 ★
                    if (handicapMode && handicapDelay > 0 && uid === songAddedByUUID) {
                        buzzTime += handicapDelay;
                    }

                    if (buzzTime < fastestTime) {
                        fastestTime = buzzTime;
                        fastestUser = data.username;
                        fastestUserId = uid;  // ★ UUIDを記録 ★
                    }
                }

                if (fastestUser && !room.buzzerUser) {
                    room.status = 'buzzed';
                    room.buzzerUser = fastestUser;
                    room.buzzerUserId = fastestUserId;  // ★ UUIDも保存 ★
                    room.buzzedAt = Date.now(); // ★ 回答開始時刻を記録 ★
                }
                return room;
            }
            return room;
        });
    },

    reportWin: async (roomId, username, songId, songData, answerTime) => {
        const roomRef = db.ref(`rooms/${roomId}`);
        await roomRef.child(`played/${songId}`).set(true);

        // Get room settings and current song info for handicap mode
        const roomSnap = await roomRef.once('value');
        const roomData = roomSnap.val() || {};
        const settings = roomData.settings || {};
        const handicapMode = settings.handicapMode || false;
        const basePoints = settings.correctPoints !== undefined ? parseInt(settings.correctPoints) : 1;
        const handicapBonus = settings.handicapBonus !== undefined ? parseInt(settings.handicapBonus) : 2;
        const songAddedBy = roomData.currentSongAddedBy || null;
        const songAddedByUUID = roomData.currentSongAddedByUUID || null;
        const questionCount = roomData.questionCount || 0;

        // 現在のユーザーのUUIDを取得
        const currentUserUUID = getOrCreateUserId();

        // Calculate score points
        let points = basePoints; // 設定値を使用
        let bonusMsg = '';

        // ハンデ判定: UUIDがあればUUIDで判定、なければユーザー名で判定
        let isSongAdder = false;
        if (songAddedByUUID && currentUserUUID) {
            isSongAdder = (songAddedByUUID === currentUserUUID);
        } else if (songAddedBy) {
            isSongAdder = (songAddedBy === username);
        }

        if (handicapMode && (songAddedBy || songAddedByUUID) && !isSongAdder) {
            points = handicapBonus; // ハンデボーナス = 設定値
            bonusMsg = ` (ハンデボーナス+${handicapBonus - basePoints}pt)`;
        }

        // Fix Score: Transactional update by matching Name
        const usersRef = roomRef.child('users');
        const q = usersRef.orderByChild('name').equalTo(username);
        const snap = await q.once('value');
        if (snap.exists()) {
            const key = Object.keys(snap.val())[0];
            await usersRef.child(key).child('score').transaction(score => (score || 0) + points);
        }

        // Format answer time for display (2 decimal places)
        const timeFormatted = answerTime !== undefined ? answerTime.toFixed(2) : null;
        const timeMsg = timeFormatted ? ` (${timeFormatted}秒)` : '';

        // Save to history with answer time
        const songTitle = songData ? songData.titleMain : '？？？';
        const songThumbnail = songData ? songData.thumbnail : '';
        const youtubeId = songData ? songData.youtubeId : '';
        await roomRef.child(`history/${questionCount}`).set({
            questionNum: questionCount,
            songTitle: songTitle,
            thumbnail: songThumbnail,
            youtubeId: youtubeId,
            winner: username,
            answerTime: answerTime !== undefined ? answerTime : null,
            timestamp: Date.now()
        });

        await roomRef.update({
            status: 'result',
            message: {
                text: `🎉 ${username} 正解！+${points}pt${bonusMsg}${timeMsg}\n正解は「${songTitle}」でした！`,
                type: "success",
                timestamp: Date.now()
            }
        });

        // ★★★ グローバル統計を保存（UUIDベース） ★★★
        try {
            const userId = getOrCreateUserId();
            const userStatsRef = db.ref(`stats/users/${userId}`);

            // ユーザー名（表示用）を保存
            await userStatsRef.child('displayName').set(username);
            await userStatsRef.child('lastActive').set(Date.now());

            await userStatsRef.child('totalCorrect').transaction(v => (v || 0) + 1);
            await userStatsRef.child('totalPoints').transaction(v => (v || 0) + points);

            // 最速回答時間を更新
            if (answerTime !== undefined) {
                const currentFastest = await userStatsRef.child('fastestAnswer').once('value');
                if (!currentFastest.exists() || answerTime < currentFastest.val()) {
                    await userStatsRef.child('fastestAnswer').set(answerTime);
                }

                // 高速回答Top5を更新
                const fastAnswersSnap = await userStatsRef.child('fastAnswers').once('value');
                let fastAnswers = fastAnswersSnap.val() || [];
                fastAnswers.push({ songTitle, time: answerTime, timestamp: Date.now() });
                fastAnswers.sort((a, b) => a.time - b.time);
                fastAnswers = fastAnswers.slice(0, 5);
                await userStatsRef.child('fastAnswers').set(fastAnswers);
            }

            // 曲統計を更新
            if (songId) {
                const songStatsRef = db.ref(`stats/songs/${songId}`);
                await songStatsRef.child('titleMain').set(songTitle);
                await songStatsRef.child('timesPlayed').transaction(v => (v || 0) + 1);
                await songStatsRef.child('timesCorrect').transaction(v => (v || 0) + 1);

                if (answerTime !== undefined) {
                    // 平均回答時間を更新（簡易計算）
                    const statsSnap = await songStatsRef.once('value');
                    const stats = statsSnap.val() || {};
                    const totalTime = (stats.totalAnswerTime || 0) + answerTime;
                    const count = stats.timesCorrect || 1;
                    await songStatsRef.update({
                        totalAnswerTime: totalTime,
                        averageAnswerTime: totalTime / count
                    });

                    // 最速回答を更新
                    if (!stats.fastestAnswer || answerTime < stats.fastestAnswer.time) {
                        await songStatsRef.child('fastestAnswer').set({ user: username, time: answerTime });
                    }
                }
            }
        } catch (e) {
            console.error('Stats save error:', e);
        }

        setTimeout(() => window.VibeQuiz.nextQuestion(roomId), 6000);
    },

    reportLoss: async (roomId, username, currentVideoTime) => {
        const roomRef = db.ref(`rooms/${roomId}`);

        // ★ UUIDベースでwrongAnswersを登録（同名ユーザー対策）★
        const userUUID = getOrCreateUserId();
        await roomRef.child(`wrongAnswers/${userUUID}`).set(true);

        // Get room settings for handicap mode penalty
        const roomSnap = await roomRef.once('value');
        const roomData = roomSnap.val() || {};
        const settings = roomData.settings || {};
        const handicapMode = settings.handicapMode || false;
        const baseWrongPoints = settings.wrongPoints !== undefined ? parseInt(settings.wrongPoints) : 0;
        const handicapPenalty = settings.handicapPenalty !== undefined ? parseInt(settings.handicapPenalty) : -1;
        const songAddedBy = roomData.currentSongAddedBy || null;
        const songAddedByUUID = roomData.currentSongAddedByUUID || null;

        // 現在のユーザーのUUIDを取得
        const currentUserUUID = getOrCreateUserId();

        // Apply wrong answer penalty (if configured)
        let penaltyMsg = '';
        let totalPenalty = baseWrongPoints; // 設定値を使用

        // ハンデ判定: UUIDがあればUUIDで判定、なければユーザー名で判定
        let isSongAdder = false;
        if (songAddedByUUID && currentUserUUID) {
            isSongAdder = (songAddedByUUID === currentUserUUID);
        } else if (songAddedBy) {
            isSongAdder = (songAddedBy === username);
        }

        // Apply additional handicap penalty if song adder got it wrong
        if (handicapMode && isSongAdder) {
            totalPenalty += handicapPenalty; // ハンデペナルティ = 設定値
            penaltyMsg = ` (ハンデペナルティ${handicapPenalty}pt)`;
        }

        // Apply penalty if any
        if (totalPenalty !== 0) {
            const usersRef = roomRef.child('users');
            const q = usersRef.orderByChild('name').equalTo(username);
            const snap = await q.once('value');
            if (snap.exists()) {
                const key = Object.keys(snap.val())[0];
                await usersRef.child(key).child('score').transaction(score => (score || 0) + totalPenalty);
            }
            if (!penaltyMsg && totalPenalty < 0) {
                penaltyMsg = ` (${totalPenalty}pt)`;
            }
        }

        const rewindTime = Math.max(0, currentVideoTime - 5);

        // ★ 回答時間を曲の制限時間から除外するためplayStartTimeを調整 ★
        // 現在のplayStartTimeに回答に費やした時間を加算
        const roomSnap2 = await roomRef.once('value');
        const currentPlayStartTime = roomSnap2.val().playStartTime || Date.now();
        const buzzedTime = roomSnap2.val().buzzedAt || Date.now();
        const answerDuration = Date.now() - buzzedTime; // 回答に費やした時間

        await roomRef.update({
            status: 'playing',
            buzzerUser: null,
            buzzTimes: null,  // ★ buzzTimesをクリア ★
            seekTo: rewindTime,
            playStartTime: currentPlayStartTime + answerDuration, // ★ 回答時間分を加算 ★
            message: {
                text: `❌ ${username} 不正解...${penaltyMsg} (5秒戻ります)`,
                type: "error",
                timestamp: Date.now()
            }
        });

        // ★★★ ユーザーの不正解統計を保存（UUIDベース） ★★★
        try {
            const userId = getOrCreateUserId();
            const userStatsRef = db.ref(`stats/users/${userId}`);
            await userStatsRef.child('displayName').set(username);
            await userStatsRef.child('totalWrong').transaction(v => (v || 0) + 1);
        } catch (e) {
            console.error('Stats save error:', e);
        }
    },

    reportTimeUp: async (roomId, correctTitle, songData, questionCount) => {
        const roomRef = db.ref(`rooms/${roomId}`);

        // Save to history
        const songThumbnail = songData ? songData.thumbnail : '';
        const youtubeId = songData ? songData.youtubeId : '';
        await roomRef.child(`history/${questionCount}`).set({
            questionNum: questionCount,
            songTitle: correctTitle,
            thumbnail: songThumbnail,
            youtubeId: youtubeId,
            winner: null,
            timestamp: Date.now()
        });

        await roomRef.update({
            status: 'result',
            message: {
                text: `⌛ 時間切れ！\n正解は「${correctTitle}」でした！`,
                type: "info",
                timestamp: Date.now()
            }
        });

        // ★★★ 曲の時間切れ統計を保存 ★★★
        try {
            if (songData && songData.youtubeId) {
                // songIdを取得（現在の部屋情報から）
                const currentSongSnap = await roomRef.child('currentSongId').once('value');
                const songId = currentSongSnap.val();
                if (songId) {
                    const songStatsRef = db.ref(`stats/songs/${songId}`);
                    await songStatsRef.child('titleMain').set(correctTitle);
                    await songStatsRef.child('timesPlayed').transaction(v => (v || 0) + 1);
                    await songStatsRef.child('timesTimeUp').transaction(v => (v || 0) + 1);
                }
            }
        } catch (e) {
            console.error('Stats save error:', e);
        }

        setTimeout(() => window.VibeQuiz.nextQuestion(roomId), 7000);
    },

    stopGame: async (roomId) => {
        await db.ref(`rooms/${roomId}`).update({ status: 'waiting', buzzerUser: null });
    },

    // Restart game (keep users, reset everything else including scores)
    restartGame: async (roomId) => {
        const roomRef = db.ref(`rooms/${roomId}`);

        // Reset scores for all users
        const usersSnap = await roomRef.child('users').once('value');
        if (usersSnap.exists()) {
            const updates = {};
            Object.keys(usersSnap.val()).forEach(uid => {
                updates[`users/${uid}/score`] = 0;
            });
            await roomRef.update(updates);
        }

        await roomRef.update({
            status: 'waiting',
            currentSongId: null,
            buzzerUser: null,
            questionCount: 0,
            played: null,
            wrongAnswers: null,
            startTime: null,
            history: null,
            message: { text: "🔄 新しいゲームを開始します！", type: "info", timestamp: Date.now() }
        });
    },

    // Clear wrong answers (restore buzzer rights)
    clearWrongAnswers: async (roomId) => {
        await db.ref(`rooms/${roomId}/wrongAnswers`).remove();
    },

    resetGame: async (roomId) => {
        await db.ref(`rooms/${roomId}`).update({
            status: 'waiting',
            currentSongId: null,
            buzzerUser: null,
            questionCount: 0,
            played: null,
            wrongAnswers: null,
            message: { text: "リセットしました", type: "info", timestamp: Date.now() }
        });
    },

    removeUser: async (roomId, userId) => {
        await db.ref(`rooms/${roomId}/users/${userId}`).remove();
    },

    // --- Playlist V3 Logic ---

    createPlaylist: async (name, isPrivate = false) => {
        const ref = db.ref('playlists').push();
        const userId = getOrCreateUserId();
        await ref.set({
            name: name,
            createdAt: Date.now(),
            isPrivate: isPrivate,  // ★ 個人用フラグ ★
            ownerUUID: isPrivate ? userId : null  // ★ 個人用の場合はオーナーUUID ★
        });
        return ref.key;
    },

    addSongToPlaylist: async (playlistId, songData) => {
        const targetId = playlistId || 'global';
        const path = targetId === 'global' ? 'playlist' : `playlists/${targetId}/songs`;

        const newSongRef = db.ref(path).push();
        await newSongRef.set({
            ...songData,
            addedAt: Date.now()
        });
        return newSongRef.key;
    },

    updateSong: async (playlistId, songId, data) => {
        const targetId = playlistId || 'global';
        const path = targetId === 'global' ? `playlist/${songId}` : `playlists/${targetId}/songs/${songId}`;
        await db.ref(path).update(data);
    },

    deleteSong: async (playlistId, songId) => {
        const targetId = playlistId || 'global';
        const path = targetId === 'global' ? `playlist/${songId}` : `playlists/${targetId}/songs/${songId}`;
        await db.ref(path).remove();
    },

    clearPlaylist: async (playlistId) => {
        const targetId = playlistId || 'global';
        const path = targetId === 'global' ? 'playlist' : `playlists/${targetId}/songs`;
        await db.ref(path).remove();
    },

    renamePlaylist: async (playlistId, newName) => {
        if (playlistId === 'global') throw new Error("Globalプレイリストの名前は変更できません");
        await db.ref(`playlists/${playlistId}`).update({ name: newName });
    },

    deletePlaylist: async (playlistId) => {
        if (playlistId === 'global') throw new Error("Globalプレイリストは削除できません");
        await db.ref(`playlists/${playlistId}`).remove();
    },

    duplicatePlaylist: async (playlistId) => {
        // Fetch Source
        let sourceName = "Global";
        let sourceSongs = {};

        if (playlistId === 'global') {
            const snap = await db.ref('playlist').once('value');
            sourceSongs = snap.val() || {};
        } else {
            const snap = await db.ref(`playlists/${playlistId}`).once('value');
            if (!snap.exists()) throw new Error("プレイリストが見つかりません");
            const val = snap.val();
            sourceName = val.name;
            sourceSongs = val.songs || {};
        }

        // Create New
        const newRef = db.ref('playlists').push();
        await newRef.set({
            name: `${sourceName} のコピー`,
            createdAt: Date.now(),
            songs: sourceSongs
        });
        return newRef.key;
    },

    // ★★★ 統計取得関数 ★★★

    // 自分の統計を取得
    getMyStats: async () => {
        const userId = getOrCreateUserId();
        const snap = await db.ref(`stats/users/${userId}`).once('value');
        return snap.val();
    },

    // ユーザー名で検索（displayNameで部分一致）
    searchUserStats: async (searchName) => {
        const snap = await db.ref('stats/users').once('value');
        const data = snap.val() || {};
        const results = [];

        Object.entries(data).forEach(([id, stats]) => {
            const name = stats.displayName || id;
            if (name.toLowerCase().includes(searchName.toLowerCase())) {
                results.push({
                    id,
                    name,
                    ...stats,
                    accuracy: (stats.totalCorrect || 0) + (stats.totalWrong || 0) > 0
                        ? Math.round((stats.totalCorrect || 0) / ((stats.totalCorrect || 0) + (stats.totalWrong || 0)) * 100)
                        : 0
                });
            }
        });

        return results;
    },

    // 全ユーザーの統計を取得（ランキング用）
    getAllUserStats: async () => {
        const snap = await db.ref('stats/users').once('value');
        const data = snap.val() || {};
        return Object.entries(data).map(([id, stats]) => ({
            id,
            name: stats.displayName || id.substring(0, 8),
            ...stats,
            accuracy: (stats.totalCorrect || 0) + (stats.totalWrong || 0) > 0
                ? Math.round((stats.totalCorrect || 0) / ((stats.totalCorrect || 0) + (stats.totalWrong || 0)) * 100)
                : 0
        }));
    },

    // 曲統計を取得
    getSongStats: async () => {
        const snap = await db.ref('stats/songs').once('value');
        const data = snap.val() || {};
        return Object.entries(data).map(([id, stats]) => ({
            id,
            ...stats,
            correctRate: stats.timesPlayed > 0
                ? Math.round((stats.timesCorrect || 0) / stats.timesPlayed * 100)
                : 0
        }));
    },

    // 全体の高速回答ランキングを取得
    getSpeedRanking: async () => {
        const usersSnap = await db.ref('stats/users').once('value');
        const users = usersSnap.val() || {};

        const allFastAnswers = [];
        Object.entries(users).forEach(([id, stats]) => {
            const displayName = stats.displayName || id.substring(0, 8);
            if (stats.fastAnswers) {
                stats.fastAnswers.forEach(fa => {
                    allFastAnswers.push({ user: displayName, ...fa });
                });
            }
        });

        return allFastAnswers.sort((a, b) => a.time - b.time).slice(0, 10);
    }
};

console.log("VibeQuiz Config Loaded");
