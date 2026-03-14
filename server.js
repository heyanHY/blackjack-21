// 多人联网后端服务 - Node.js + WebSocket
// 运行方法：node server.js，然后打开浏览器访问 http://localhost:3000

const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket']
})

// 静态文件服务
app.use(express.static(path.join(__dirname, './')))

// 房间管理
const rooms = new Map()

// 生成6位房间号
function generateRoomId() {
    let roomId
    do {
        roomId = Math.floor(100000 + Math.random() * 900000).toString()
    } while (rooms.has(roomId))
    return roomId
}

// 牌堆类
class Deck {
    constructor() {
        this.cards = []
        const SUITS = [
            { symbol: '♠', color: 'black' },
            { symbol: '♥', color: 'red' },
            { symbol: '♣', color: 'black' },
            { symbol: '♦', color: 'red' }
        ]
        const RANKS = [
            { rank: 'A', value: 1 },
            { rank: '2', value: 2 },
            { rank: '3', value: 3 },
            { rank: '4', value: 4 },
            { rank: '5', value: 5 },
            { rank: '6', value: 6 },
            { rank: '7', value: 7 },
            { rank: '8', value: 8 },
            { rank: '9', value: 9 },
            { rank: '10', value: 10 },
            { rank: 'J', value: 10 },
            { rank: 'Q', value: 10 },
            { rank: 'K', value: 10 }
        ]
        
        // 4副牌
        for (let deck = 0; deck < 4; deck++) {
            for (let suit of SUITS) {
                for (let rank of RANKS) {
                    this.cards.push({
                        suit: suit.symbol,
                        rank: rank.rank,
                        value: rank.value,
                        color: suit.color
                    })
                }
            }
        }
        this.shuffle()
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]]
        }
    }

    deal() {
        if (this.cards.length < 20) {
            this.constructor()
        }
        return this.cards.pop()
    }
}

// WebSocket连接处理
io.on('connection', (socket) => {
    console.log('用户连接:', socket.id)

    // 创建房间
    socket.on('createRoom', (user) => {
        const roomId = generateRoomId()
        const room = {
            id: roomId,
            host: user,
            players: [
                {
                    ...user,
                    socketId: socket.id,
                    isReady: true,
                    cards: [],
                    value: 0,
                    bet: 0,
                    status: 'waiting'
                }
            ],
            gameStarted: false,
            deck: new Deck(),
            dealer: {
                nickname: user.nickname,
                cards: [],
                value: 0
            }
        }
        
        rooms.set(roomId, room)
        socket.join(roomId)
        socket.emit('roomCreated', room)
        console.log(`房间创建: ${roomId}，房主: ${user.nickname}`)
    })

    // 加入房间
    socket.on('joinRoom', (roomId, user) => {
        const room = rooms.get(roomId)
        if (!room) {
            socket.emit('error', '房间不存在')
            return
        }
        
        if (room.players.length >= 6) {
            socket.emit('error', '房间已满')
            return
        }
        
        if (room.gameStarted) {
            socket.emit('error', '游戏已经开始')
            return
        }
        
        const newPlayer = {
            ...user,
            socketId: socket.id,
            isReady: false,
            cards: [],
            value: 0,
            bet: 0,
            status: 'waiting'
        }
        
        room.players.push(newPlayer)
        socket.join(roomId)
        socket.emit('roomJoined', room)
        io.to(roomId).emit('roomUpdated', room)
        console.log(`用户 ${user.nickname} 加入房间 ${roomId}`)
    })

    // 申请坐庄
    socket.on('applyHost', (roomId, user) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        if (room.host) {
            socket.emit('error', '已经有庄家了')
            return
        }
        
        room.host = user
        const player = room.players.find(p => p.id === user.id)
        if (player) {
            player.isHost = true
        }
        
        io.to(roomId).emit('roomUpdated', room)
    })

    // 准备/取消准备
    socket.on('toggleReady', (roomId, userId) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        const player = room.players.find(p => p.id === userId)
        if (player) {
            player.isReady = !player.isReady
            io.to(roomId).emit('roomUpdated', room)
        }
    })

    // 开始游戏
    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        const allReady = room.players.every(p => p.isReady)
        if (!allReady || !room.host) {
            socket.emit('error', '还有玩家未准备或暂无庄家')
            return
        }
        
        room.gameStarted = true
        room.deck = new Deck()
        room.dealer = {
            nickname: room.host.nickname,
            cards: [],
            value: 0
        }
        
        // 重置玩家状态
        room.players.forEach(player => {
            player.cards = []
            player.value = 0
            player.bet = 0
            player.status = 'waiting'
        })
        
        io.to(roomId).emit('gameStarted', room)
    })

    // 下注
    socket.on('placeBet', (roomId, userId, betAmount) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        const player = room.players.find(p => p.id === userId)
        if (player && betAmount <= player.balance) {
            player.bet = betAmount
            player.status = 'playing'
            
            // 检查所有玩家是否都下注了
            const allBet = room.players.every(p => p.bet > 0 || p.status === 'bust')
            if (allBet) {
                // 发初始牌
                dealInitialCards(room)
            }
            
            io.to(roomId).emit('gameUpdated', room)
        }
    })

    // 要牌
    socket.on('hit', (roomId, userId) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        const player = room.players.find(p => p.id === userId)
        if (player && player.status === 'playing') {
            player.cards.push(room.deck.deal())
            player.value = calculateHandValue(player.cards)
            
            if (player.value > 21) {
                player.status = 'bust'
            }
            
            io.to(roomId).emit('gameUpdated', room)
            
            // 检查是否所有玩家都完成操作
            checkAllPlayersDone(room)
        }
    })

    // 停牌
    socket.on('stand', (roomId, userId) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        const player = room.players.find(p => p.id === userId)
        if (player && player.status === 'playing') {
            player.status = 'stand'
            io.to(roomId).emit('gameUpdated', room)
            
            // 检查是否所有玩家都完成操作
            checkAllPlayersDone(room)
        }
    })

    // 下一局
    socket.on('nextRound', (roomId) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        // 轮换庄家
        const currentHostIndex = room.players.findIndex(p => p.id === room.host.id)
        const nextHostIndex = (currentHostIndex + 1) % room.players.length
        room.host = room.players[nextHostIndex]
        
        // 重置游戏状态
        room.deck = new Deck()
        room.dealer = {
            nickname: room.host.nickname,
            cards: [],
            value: 0
        }
        
        room.players.forEach(player => {
            player.cards = []
            player.value = 0
            player.bet = 0
            player.status = 'waiting'
            player.isReady = false
        })
        
        room.gameStarted = false
        
        io.to(roomId).emit('nextRound', room)
    })

    // 离开房间
    socket.on('leaveRoom', (roomId, userId) => {
        const room = rooms.get(roomId)
        if (!room) return
        
        room.players = room.players.filter(p => p.id !== userId)
        socket.leave(roomId)
        
        if (room.players.length === 0) {
            rooms.delete(roomId)
            console.log(`房间 ${roomId} 已解散`)
        } else {
            // 如果离开的是房主，重新分配房主
            if (room.host && room.host.id === userId) {
                room.host = room.players[0]
            }
            io.to(roomId).emit('roomUpdated', room)
        }
    })

    // 断开连接
    socket.on('disconnect', () => {
        console.log('用户断开连接:', socket.id)
        // 清理用户所在的房间
        rooms.forEach((room, roomId) => {
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id)
            if (playerIndex !== -1) {
                const player = room.players[playerIndex]
                room.players.splice(playerIndex, 1)
                
                if (room.players.length === 0) {
                    rooms.delete(roomId)
                    console.log(`房间 ${roomId} 已解散`)
                } else {
                    // 如果离开的是房主，重新分配房主
                    if (room.host && room.host.id === player.id) {
                        room.host = room.players[0]
                    }
                    io.to(roomId).emit('roomUpdated', room)
                }
            }
        })
    })
})

// 发初始牌
function dealInitialCards(room) {
    // 给每个玩家发2张牌
    room.players.forEach(player => {
        if (player.status === 'playing') {
            player.cards.push(room.deck.deal())
            player.cards.push(room.deck.deal())
            player.value = calculateHandValue(player.cards)
            
            // 检查是否21点
            if (player.value === 21) {
                player.status = 'stand'
            }
        }
    })
    
    // 给庄家发2张牌，第一张隐藏
    room.dealer.cards.push({ ...room.deck.deal(), hidden: true })
    room.dealer.cards.push(room.deck.deal())
    room.dealer.value = calculateHandValue(room.dealer.cards.filter(c => !c.hidden))
    
    io.to(room.id).emit('gameUpdated', room)
    
    // 检查是否所有玩家都已经是stand状态
    checkAllPlayersDone(room)
}

// 计算手牌点数
function calculateHandValue(cards) {
    let total = 0
    let aces = 0

    cards.forEach(card => {
        if (!card.hidden) {
            total += card.value
            if (card.rank === 'A') {
                aces++
            }
        }
    })

    for (let i = 0; i < aces; i++) {
        if (total + 10 <= 21) {
            total += 10
        }
    }

    return total
}

// 检查所有玩家是否完成操作
function checkAllPlayersDone(room) {
    const allDone = room.players.every(p => p.status === 'stand' || p.status === 'bust')
    if (allDone) {
        // 庄家回合
        setTimeout(() => dealerTurn(room), 1000)
    }
}

// 庄家回合
function dealerTurn(room) {
    // 显示庄家第一张牌
    room.dealer.cards[0].hidden = false
    room.dealer.value = calculateHandValue(room.dealer.cards)
    
    io.to(room.id).emit('gameUpdated', room)
    
    const dealDealerCard = () => {
        if (room.dealer.value < 17) {
            room.dealer.cards.push(room.deck.deal())
            room.dealer.value = calculateHandValue(room.dealer.cards)
            io.to(room.id).emit('gameUpdated', room)
            setTimeout(dealDealerCard, 1000)
        } else {
            // 计算结果
            calculateResults(room)
        }
    }
    
    setTimeout(dealDealerCard, 1000)
}

// 计算结果
function calculateResults(room) {
    const dealer = room.dealer
    const dealerBust = dealer.value > 21
    
    room.players.forEach(player => {
        if (player.status === 'bust') {
            player.status = 'lose'
            player.balance -= player.bet
        } else if (player.status === 'stand') {
            if (dealerBust) {
                player.status = 'win'
                player.balance += player.bet
            } else if (player.value > dealer.value) {
                player.status = 'win'
                player.balance += player.bet
            } else if (player.value < dealer.value) {
                player.status = 'lose'
                player.balance -= player.bet
            } else {
                player.status = 'push'
            }
        }
    })
    
    io.to(room.id).emit('gameFinished', room)
}

// Vercel 部署不需要监听端口，导出 app 即可
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000
    server.listen(PORT, () => {
        console.log(`21点游戏服务器运行在 http://localhost:${PORT}`)
        console.log('请在浏览器中打开上述地址开始游戏')
    })
}

module.exports = app
