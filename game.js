// 游戏全局状态
const gameState = {
    currentUser: null,
    currentRoom: null,
    socket: null, // 实际项目中这里是WebSocket连接
    page: 'login',
    selectedBet: 0,
    isHost: false,
    isReady: false
}

// 扑克牌类
class Card {
    static SUITS = [
        { symbol: '♠', color: 'black' },
        { symbol: '♥', color: 'red' },
        { symbol: '♣', color: 'black' },
        { symbol: '♦', color: 'red' }
    ]
    
    static RANKS = [
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
}

// 牌堆类，4副牌
class Deck {
    constructor() {
        this.cards = []
        // 4副牌
        for (let deck = 0; deck < 4; deck++) {
            for (let suit of Card.SUITS) {
                for (let rank of Card.RANKS) {
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
        if (this.cards.length < 20) { // 牌不足时重新洗牌
            this.constructor()
        }
        return this.cards.pop()
    }
}

// 页面切换
function showPage(pageName) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active')
    })
    document.getElementById(`${pageName}-page`).classList.add('active')
    gameState.page = pageName
}

// 生成随机6位房间号
function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString()
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

    // A可以算11点
    for (let i = 0; i < aces; i++) {
        if (total + 10 <= 21) {
            total += 10
        }
    }

    return total
}

// 创建卡片元素
function createCardElement(card) {
    const cardDiv = document.createElement('div')
    cardDiv.className = 'card-item'
    
    if (card.hidden) {
        cardDiv.classList.add('card-back')
        const pattern = document.createElement('div')
        pattern.className = 'card-back-pattern'
        cardDiv.appendChild(pattern)
    } else {
        const content = document.createElement('div')
        content.className = 'card-content'
        
        const topRank = document.createElement('div')
        topRank.className = 'card-rank top'
        topRank.textContent = card.rank
        topRank.style.color = card.color
        
        const suit = document.createElement('div')
        suit.className = 'card-suit'
        suit.textContent = card.suit
        suit.style.color = card.color
        
        const bottomRank = document.createElement('div')
        bottomRank.className = 'card-rank bottom'
        bottomRank.textContent = card.rank
        bottomRank.style.color = card.color
        
        content.appendChild(topRank)
        content.appendChild(suit)
        content.appendChild(bottomRank)
        cardDiv.appendChild(content)
    }
    
    return cardDiv
}

// 更新房间玩家列表
function updateRoomPlayers() {
    const listContainer = document.getElementById('room-players-list')
    if (!listContainer) return
    
    listContainer.innerHTML = ''
    
    gameState.currentRoom.players.forEach(player => {
        const playerItem = document.createElement('div')
        playerItem.className = 'player-item'
        
        playerItem.innerHTML = `
            <div class="player-info">
                <div class="player-avatar" style="background-color: ${player.avatarColor}">
                    ${player.nickname.charAt(0)}
                </div>
                <div class="player-detail">
                    <div class="player-name">${player.nickname} ${player.id === gameState.currentUser.id ? '(你)' : ''}</div>
                    <div class="player-balance">积分: ${player.balance}</div>
                </div>
            </div>
            <div class="player-status ${player.isReady ? 'status-ready' : 'status-not-ready'}">
                ${player.isReady ? '已准备' : '未准备'}
            </div>
        `
        
        listContainer.appendChild(playerItem)
    })
    
    // 更新玩家数量
    document.getElementById('room-player-count').textContent = `玩家: ${gameState.currentRoom.players.length}/6`
    
    // 检查是否所有玩家都准备了
    const allReady = gameState.currentRoom.players.every(p => p.isReady)
    const startBtn = document.getElementById('start-game-btn')
    if (startBtn) {
        startBtn.style.display = (gameState.isHost && allReady && gameState.currentRoom.host) ? 'block' : 'none'
    }
}

// 更新庄家信息
function updateHostInfo() {
    const hostContainer = document.getElementById('current-host')
    if (!hostContainer) return
    
    if (gameState.currentRoom.host) {
        const host = gameState.currentRoom.host
        hostContainer.innerHTML = `
            <div class="player-info" style="justify-content: center;">
                <div class="player-avatar" style="background-color: ${host.avatarColor}">
                    ${host.nickname.charAt(0)}
                </div>
                <div class="player-detail">
                    <div class="player-name">${host.nickname}</div>
                    <div class="player-balance">积分: ${host.balance}</div>
                </div>
            </div>
        `
    } else {
        hostContainer.innerHTML = `
            暂无庄家，<button id="apply-host-btn" class="btn btn-small btn-warning">申请坐庄</button>
        `
        // 重新绑定申请坐庄事件
        document.getElementById('apply-host-btn')?.addEventListener('click', applyHost)
    }
}

// 登录
document.getElementById('login-btn')?.addEventListener('click', () => {
    const nickname = document.getElementById('nickname').value.trim()
    if (!nickname) {
        alert('请输入昵称')
        return
    }
    
    // 生成随机用户ID和头像颜色
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#ff9800', '#ff5722']
    gameState.currentUser = {
        id: Date.now().toString(),
        nickname: nickname,
        balance: 10000,
        avatarColor: colors[Math.floor(Math.random() * colors.length)]
    }
    
    // 更新用户信息显示
    document.getElementById('user-nickname').textContent = nickname
    document.getElementById('user-balance').textContent = '10000'
    
    // 进入大厅
    showPage('hall')
})

// 创建房间
document.getElementById('create-room-btn')?.addEventListener('click', () => {
    const roomId = generateRoomId()
    gameState.currentRoom = {
        id: roomId,
        host: gameState.currentUser,
        players: [gameState.currentUser],
        gameStarted: false,
        deck: new Deck()
    }
    gameState.isHost = true
    gameState.isReady = true
    gameState.currentUser.isReady = true
    
    document.getElementById('current-room-id').textContent = roomId
    updateRoomPlayers()
    updateHostInfo()
    
    showPage('room')
})

// 加入房间
document.getElementById('join-room-btn')?.addEventListener('click', () => {
    const roomId = document.getElementById('room-id-input').value.trim()
    if (!roomId || roomId.length !== 6) {
        alert('请输入6位房间号')
        return
    }
    
    // 模拟加入房间
    gameState.currentRoom = {
        id: roomId,
        host: null,
        players: [
            gameState.currentUser,
            {
                id: '1',
                nickname: '玩家1',
                balance: 12000,
                avatarColor: '#2196f3',
                isReady: true
            },
            {
                id: '2',
                nickname: '玩家2',
                balance: 8500,
                avatarColor: '#ff9800',
                isReady: false
            }
        ],
        gameStarted: false,
        deck: new Deck()
    }
    gameState.isHost = false
    gameState.isReady = false
    
    document.getElementById('current-room-id').textContent = roomId
    updateRoomPlayers()
    updateHostInfo()
    
    showPage('room')
})

// 离开房间
document.getElementById('leave-room-btn')?.addEventListener('click', () => {
    if (confirm('确定要离开房间吗？')) {
        gameState.currentRoom = null
        gameState.isHost = false
        gameState.isReady = false
        showPage('hall')
    }
})

// 申请坐庄
function applyHost() {
    if (gameState.currentRoom.host) {
        alert('已经有庄家了')
        return
    }
    
    gameState.currentRoom.host = gameState.currentUser
    gameState.isHost = true
    updateHostInfo()
    updateRoomPlayers()
    alert('你已成为庄家')
}

// 准备/取消准备
document.getElementById('ready-btn')?.addEventListener('click', () => {
    gameState.isReady = !gameState.isReady
    const player = gameState.currentRoom.players.find(p => p.id === gameState.currentUser.id)
    player.isReady = gameState.isReady
    
    document.getElementById('ready-btn').textContent = gameState.isReady ? '取消准备' : '准备游戏'
    updateRoomPlayers()
})

// 复制房间号
document.getElementById('copy-room-id-btn')?.addEventListener('click', () => {
    const roomId = gameState.currentRoom.id
    navigator.clipboard.writeText(roomId).then(() => {
        alert('房间号已复制')
    })
})

// 开始游戏
document.getElementById('start-game-btn')?.addEventListener('click', () => {
    if (!gameState.currentRoom.host) {
        alert('还没有庄家')
        return
    }
    
    const allReady = gameState.currentRoom.players.every(p => p.isReady)
    if (!allReady) {
        alert('还有玩家未准备')
        return
    }
    
    gameState.currentRoom.gameStarted = true
    
    // 初始化游戏数据
    gameState.currentRoom.deck = new Deck()
    gameState.currentRoom.players.forEach(player => {
        player.cards = []
        player.value = 0
        player.bet = 0
        player.status = 'waiting'
    })
    
    gameState.currentRoom.dealer = {
        nickname: gameState.currentRoom.host.nickname,
        cards: [],
        value: 0
    }
    
    // 进入游戏页面
    document.getElementById('game-room-id').textContent = gameState.currentRoom.id
    document.getElementById('game-dealer-name').textContent = gameState.currentRoom.host.nickname
    document.getElementById('game-user-balance').textContent = gameState.currentUser.balance
    
    showPage('game')
    
    // 显示下注界面
    document.getElementById('bet-section').style.display = 'block'
    document.getElementById('game-actions').style.display = 'none'
    document.getElementById('result-section').style.display = 'none'
    document.getElementById('waiting-tip').style.display = 'none'
})

// 下注按钮
document.querySelectorAll('.bet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const value = parseInt(btn.dataset.value)
        if (value > gameState.currentUser.balance) {
            alert('积分不足')
            return
        }
        
        document.querySelectorAll('.bet-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        gameState.selectedBet = value
        document.getElementById('selected-bet').textContent = value
        document.getElementById('confirm-bet-btn').disabled = false
    })
})

// 确认下注
document.getElementById('confirm-bet-btn')?.addEventListener('click', () => {
    if (gameState.selectedBet === 0) return
    
    const player = gameState.currentRoom.players.find(p => p.id === gameState.currentUser.id)
    player.bet = gameState.selectedBet
    player.status = 'playing'
    
    document.getElementById('bet-section').style.display = 'none'
    document.getElementById('waiting-tip').style.display = 'block'
    document.getElementById('waiting-tip').textContent = '等待其他玩家下注...'
    
    // 模拟其他玩家下注
    setTimeout(() => {
        gameState.currentRoom.players.forEach(player => {
            if (player.id !== gameState.currentUser.id) {
                player.bet = Math.floor(Math.random() * 5) * 100 + 100
                player.status = 'playing'
            }
        })
        
        // 发初始牌
        dealInitialCards()
    }, 1500)
})

// 发初始牌
function dealInitialCards() {
    const deck = gameState.currentRoom.deck
    const dealer = gameState.currentRoom.dealer
    
    // 给每个玩家发2张牌
    gameState.currentRoom.players.forEach(player => {
        player.cards.push(deck.deal())
        player.cards.push(deck.deal())
        player.value = calculateHandValue(player.cards)
    })
    
    // 给庄家发2张牌，第一张隐藏
    dealer.cards.push({ ...deck.deal(), hidden: true })
    dealer.cards.push(deck.deal())
    dealer.value = calculateHandValue(dealer.cards)
    
    // 更新界面
    renderGameState()
    
    document.getElementById('waiting-tip').style.display = 'none'
    document.getElementById('game-actions').style.display = 'flex'
    
    // 检查是否直接21点
    const self = gameState.currentRoom.players.find(p => p.id === gameState.currentUser.id)
    if (self.value === 21) {
        setTimeout(() => stand(), 500)
    }
}

// 渲染游戏状态
function renderGameState() {
    // 渲染庄家牌
    const dealerCardsContainer = document.getElementById('dealer-cards')
    dealerCardsContainer.innerHTML = ''
    gameState.currentRoom.dealer.cards.forEach(card => {
        dealerCardsContainer.appendChild(createCardElement(card))
    })
    
    // 渲染玩家
    const playersContainer = document.getElementById('players-section')
    playersContainer.innerHTML = ''
    
    gameState.currentRoom.players.forEach(player => {
        const playerDiv = document.createElement('div')
        playerDiv.className = 'game-player-item'
        
        let statusText = ''
        let statusClass = ''
        switch(player.status) {
            case 'waiting': statusText = '等待下注'; statusClass = 'text-orange'; break
            case 'playing': statusText = '游戏中'; statusClass = 'text-yellow'; break
            case 'stand': statusText = '停牌'; statusClass = 'text-orange'; break
            case 'bust': statusText = '爆牌'; statusClass = 'text-red'; break
            case 'win': statusText = '胜利'; statusClass = 'text-green'; break
            case 'lose': statusText = '失败'; statusClass = 'text-red'; break
            case 'push': statusText = '平局'; statusClass = 'text-yellow'; break
        }
        
        playerDiv.innerHTML = `
            <div class="game-player-header">
                <div class="game-player-info">
                    <div class="game-player-avatar" style="background-color: ${player.avatarColor}">
                        ${player.nickname.charAt(0)}
                    </div>
                    <div>
                        <span class="game-player-name">${player.nickname} ${player.id === gameState.currentUser.id ? '(你)' : ''}</span>
                        <span class="game-player-bet">下注: ${player.bet}</span>
                    </div>
                </div>
                <div class="game-player-status ${statusClass}">${statusText}</div>
            </div>
            <div class="game-player-cards" id="player-cards-${player.id}"></div>
            <div class="card-value">点数: ${player.value}</div>
        `
        
        playersContainer.appendChild(playerDiv)
        
        // 渲染玩家的牌
        const playerCardsContainer = document.getElementById(`player-cards-${player.id}`)
        player.cards.forEach(card => {
            playerCardsContainer.appendChild(createCardElement(card))
        })
    })
}

// 要牌
document.getElementById('hit-btn')?.addEventListener('click', hit)

function hit() {
    const deck = gameState.currentRoom.deck
    const self = gameState.currentRoom.players.find(p => p.id === gameState.currentUser.id)
    
    // 发一张牌
    self.cards.push(deck.deal())
    self.value = calculateHandValue(self.cards)
    
    renderGameState()
    
    if (self.value > 21) {
        // 爆牌
        self.status = 'bust'
        document.getElementById('game-actions').style.display = 'none'
        document.getElementById('waiting-tip').style.display = 'block'
        document.getElementById('waiting-tip').textContent = '你爆牌了，等待其他玩家操作...'
        setTimeout(() => nextPlayer(), 1500)
    }
}

// 停牌
document.getElementById('stand-btn')?.addEventListener('click', stand)

function stand() {
    const self = gameState.currentRoom.players.find(p => p.id === gameState.currentUser.id)
    self.status = 'stand'
    
    document.getElementById('game-actions').style.display = 'none'
    document.getElementById('waiting-tip').style.display = 'block'
    document.getElementById('waiting-tip').textContent = '等待其他玩家操作...'
    
    setTimeout(() => nextPlayer(), 1000)
}

// 模拟其他玩家操作
function nextPlayer() {
    const deck = gameState.currentRoom.deck
    let allFinished = true
    
    gameState.currentRoom.players.forEach(player => {
        if (player.id !== gameState.currentUser.id && player.status === 'playing') {
            allFinished = false
            // 简单AI：小于17点要牌，否则停牌
            if (player.value < 17) {
                player.cards.push(deck.deal())
                player.value = calculateHandValue(player.cards)
                if (player.value > 21) {
                    player.status = 'bust'
                }
            } else {
                player.status = 'stand'
            }
        }
    })
    
    renderGameState()
    
    if (allFinished) {
        // 所有玩家操作完毕，庄家回合
        setTimeout(() => dealerTurn(), 1500)
    } else {
        setTimeout(() => nextPlayer(), 1000)
    }
}

// 庄家回合
function dealerTurn() {
    const deck = gameState.currentRoom.deck
    const dealer = gameState.currentRoom.dealer
    
    document.getElementById('waiting-tip').textContent = '庄家正在要牌...'
    document.getElementById('dealer-value').style.display = 'block'
    
    // 显示庄家第一张牌
    dealer.cards[0].hidden = false
    dealer.value = calculateHandValue(dealer.cards)
    
    renderGameState()
    
    // 庄家小于17点必须要牌
    const dealDealerCard = () => {
        if (dealer.value < 17) {
            dealer.cards.push(deck.deal())
            dealer.value = calculateHandValue(dealer.cards)
            renderGameState()
            document.getElementById('dealer-value').textContent = `点数: ${dealer.value}`
            setTimeout(dealDealerCard, 1000)
        } else {
            setTimeout(calculateResults, 1500)
        }
    }
    
    document.getElementById('dealer-value').textContent = `点数: ${dealer.value}`
    setTimeout(dealDealerCard, 1000)
}

// 计算结果
function calculateResults() {
    const players = gameState.currentRoom.players
    const dealer = gameState.currentRoom.dealer
    const dealerBust = dealer.value > 21
    let selfResult = ''
    
    players.forEach(player => {
        if (player.status === 'bust') {
            // 玩家爆牌直接输
            player.status = 'lose'
            player.balance -= player.bet
        } else if (player.status === 'stand') {
            if (dealerBust) {
                // 庄家爆牌，玩家赢
                player.status = 'win'
                player.balance += player.bet
            } else if (player.value > dealer.value) {
                // 玩家点数大，赢
                player.status = 'win'
                player.balance += player.bet
            } else if (player.value < dealer.value) {
                // 庄家点数大，玩家输
                player.status = 'lose'
                player.balance -= player.bet
            } else {
                // 平局
                player.status = 'push'
            }
        }
        
        // 更新当前用户余额
        if (player.id === gameState.currentUser.id) {
            gameState.currentUser.balance = player.balance
            selfResult = player.status
        }
    })
    
    renderGameState()
    
    // 显示结果
    document.getElementById('waiting-tip').style.display = 'none'
    document.getElementById('result-section').style.display = 'block'
    
    const resultText = document.getElementById('result-text')
    if (selfResult === 'win') {
        resultText.textContent = `恭喜你赢了！获得 ${gameState.selectedBet} 积分`
        resultText.className = 'result-text text-green'
    } else if (selfResult === 'lose') {
        resultText.textContent = `很遗憾你输了，失去 ${gameState.selectedBet} 积分`
        resultText.className = 'result-text text-red'
    } else {
        resultText.textContent = '平局！积分不变'
        resultText.className = 'result-text text-yellow'
    }
    
    // 更新余额显示
    document.getElementById('game-user-balance').textContent = gameState.currentUser.balance
    document.getElementById('user-balance').textContent = gameState.currentUser.balance
}

// 下一局
document.getElementById('next-round-btn')?.addEventListener('click', () => {
    // 重置游戏状态
    gameState.selectedBet = 0
    document.getElementById('selected-bet').textContent = '0'
    document.querySelectorAll('.bet-btn').forEach(b => b.classList.remove('active'))
    document.getElementById('confirm-bet-btn').disabled = true
    
    gameState.currentRoom.deck = new Deck()
    gameState.currentRoom.dealer.cards = []
    gameState.currentRoom.dealer.value = 0
    
    gameState.currentRoom.players.forEach(player => {
        player.cards = []
        player.value = 0
        player.bet = 0
        player.status = 'waiting'
    })
    
    document.getElementById('dealer-value').style.display = 'none'
    document.getElementById('result-section').style.display = 'none'
    document.getElementById('bet-section').style.display = 'block'
    
    // 轮换庄家
    const currentHostIndex = gameState.currentRoom.players.findIndex(p => p.id === gameState.currentRoom.host.id)
    const nextHostIndex = (currentHostIndex + 1) % gameState.currentRoom.players.length
    gameState.currentRoom.host = gameState.currentRoom.players[nextHostIndex]
    gameState.isHost = gameState.currentRoom.host.id === gameState.currentUser.id
    
    renderGameState()
})

// 返回房间
document.getElementById('back-to-room-btn')?.addEventListener('click', () => {
    gameState.currentRoom.gameStarted = false
    gameState.currentRoom.players.forEach(player => {
        player.isReady = false
    })
    gameState.isReady = false
    document.getElementById('ready-btn').textContent = '准备游戏'
    
    updateRoomPlayers()
    updateHostInfo()
    showPage('room')
})

// 初始化
window.addEventListener('DOMContentLoaded', () => {
    showPage('login')
})

