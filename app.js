const express = require('express')
const path = require('path')
const bodyParser = require('body-parser')
const request = require('request')
const passport = require('passport')
const googleStrategy = require('passport-google-oauth').OAuth2Strategy
const dbConnection = require('./config/database')
const cookieSession = require('cookie-session')
const bcrypt = require('bcrypt')
const { check, validationResult } = require('express-validator')

const apiKey = 'AIzaSyBIiEa3NQzYRdr7pgsnujdjpqq5lwll_NE'
const app = express()


app.use(express.static(path.join(__dirname, 'public')))
app.use(bodyParser.urlencoded({extended: true}))
app.set('view engine', 'ejs')

app.use(passport.initialize())
app.use(passport.session())
app.use(cookieSession({
    name: 'session',
    keys: ['key1', 'key2'],
    maxAge: 3600 * 1000
}))

const ifNotLoggedIn = (req, res, next) => {
    if(!req.session.isLoggedin) {
        return res.render('login')
    }
    next()
}

const ifLoggedIn = (req, res, next) => {
    if(req.session.isLoggedin) {
        return res.redirect('/shelf')
    }
    next()
}

app.get('/', ifNotLoggedIn, (req, res) => {
        res.render('index')
})


app.get('/login', ifNotLoggedIn, (req, res, next) => {
    let sql = 'SELECT `name` FROM `users` WHERE `id` = ?'
    dbConnection.execute(sql, [req.session.userId]).then(([rows]) => {
        console.log(req.session.userId)
        res.render('userPanel', {
            name: rows[0].name
        })
    })
    
})

app.get('/registration', (req, res) => {
    res.render('registration')
})

app.post('/login', ifLoggedIn, [
    check('email').custom((value) => {
        let sql = 'SELECT `email` FROM `users` WHERE `email` = ?'
        return dbConnection.execute(sql, [value]).then(([rows]) => {
            if(rows.length == 1) {
                return true
            }
            return Promise.reject('Invalid Email Address!')
        })
    }),
    check('password', 'Password is empty!').trim().not().isEmpty()
], (req, res) => {
    const errors = validationResult(req)
    const {email, password} = req.body
    if(errors.isEmpty()) {
        let sql = 'SELECT * FROM `users` WHERE `email` = ?'
        dbConnection.execute(sql, [email]).then(([rows]) => {
            bcrypt.compare(password, rows[0].password).then(compareResult => {
                if(compareResult === true) {
                    req.session.isLoggedin = true
                    req.session.userId = rows[0].id
                    req.session.userName = rows[0].name
                    req.session.userSurname = rows[0].surname
                    console.log(req.session.userId)
                    res.redirect('/')
                } else {
                    res.render('login', {
                        errors: 'Invalid Password!'
                    })
                }
            }).catch(err => {
                if (err) throw err
            })
        }).catch(err => {
            if (err) throw err
        })
    } else {
        console.log(errors)
        res.render('login', {
            errors: errors
        })
    }
})

app.get('/search', (req, res) => {
    res.render('search', {
        books: null,
        error: null
    })
})

app.get('/auth/google',
        passport.authenticate('google', {
            scope: ['https://www.googleapis.com/auth/plus.login']
        })
)

app.get('/auth/google/callback',
        passport.authenticate('google', {failureRedirect: '/login'}), 
        (req, res) => {
            res.redirect('/')
        }
)

app.post('/search', (req, res) => {
    let title = req.body.title

    let url = `https://www.googleapis.com/books/v1/volumes?q=${title}
    &key=${apiKey}`

    request(url, (err, response, body) => {
        if(err) throw err

        let bookData = JSON.parse(body)
        res.render('search', {
            books: bookData.items,
            error: null
        })
    })
})

app.post('/registration', ifLoggedIn, [
    check('email', 'Invalid email address!').isEmail().custom((value) => {
        let sql = 'SELECT `email` FROM `users` WHERE `email` = ?'
        return dbConnection.execute(sql, [value]).then(([rows]) => {
            if(rows.length > 0) {
                return Promise.reject('Invalid Email Address!')
            }
            return true
        })
    })// Additional Validate functions
], (req, res) => {
    const errors = validationResult(req)
    const {name, surname, email, password, confirmPassword} = req.body

    if(errors.isEmpty()) {

        bcrypt.hash(password, 12).then((hashedPassword) => {
            let sql = 'INSERT INTO `users`(`name`, `surname`, `email`,'
                    + '`password`) VALUES(?, ?, ?, ?)'

            dbConnection.execute(sql, [name, surname, email, hashedPassword])
            .then(result => {
                res.render('index')
            }).catch(err => {
                if(err) throw err
            })
        }).catch(err => {
            if(err) throw err
        })
    } else {
        // errors.map((error) => {
        //     return error.msg
        // })
        console.log(errors)
        res.render('registration', {
            errors: errors,
            oldData: req.body
        })
    }

})


app.get('/add/:bookId', ifNotLoggedIn, (req, res) => {
    let sql = 'INSERT INTO `loans`(id_user, id_book, book_title, book_img,'
            + 'loan_date) VALUES (?, ?, ?, ?, ?)'
    let d = new Date()
    let today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
    let id =   req.params.bookId
    let url = `https://www.googleapis.com/books/v1/volumes/${id}`


    request(url, (err, response, body) => {
        if (err) throw err
        let img = ''
        let bookData = JSON.parse(body)

        if(bookData.volumeInfo.imageLinks.thumbnail) {
            img = bookData.volumeInfo.imageLinks.thumbnail
        } else {
            img = 'https://external-content.duckduckgo.com/iu/?'
                + 'u=https%3A%2F%2Fd1yn1kh78jj1rr.cloudfront.net%2Fimage%2Fthum'
                + 'bnail%2FHTj88dJU-j5dutf3f%2F17369030_detail_high_thumb.jpg&f'
                + '=1&nofb=1'
        }

        dbConnection.execute(sql, [req.session.userId, id, 
            bookData.volumeInfo.title, img, today
        ]).then(result => {
            res.redirect('/shelf')
        }).catch(err => {
            if(err) throw err
        })
    })
})

app.get('/return/:bookId', (req, res) => {
    let sql = 'UPDATE `loans` SET `return_date` = ?, `returned` = 1  WHERE'
            + '`id_loan` = ?'
    let d = new Date()
    let today = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
    
    dbConnection.execute(sql, [today, req.params.bookId]).then(result => {
        res.redirect('/shelf')
    }).catch(err => {
        if(err) throw err
    })
})

app.get('/logout', (req, res) => {
    req.session = null
    res.redirect('/')
})

app.get('/shelf', (req, res) => {
    let sql = 'SELECT * from `loans` WHERE `id_user` = ? AND `returned` = 0'

    dbConnection.execute(sql, [req.session.userId]).then(([rows]) => {

        res.render('shelf', {
            books: rows
        })
    })
})

app.get('/detail/:bookId', (req, res) => {
    let id = req.params.bookId
    let url = `https://www.googleapis.com/books/v1/volumes/${id}`
    
    request(url, (err, response, body) => {
        if(err) throw err

        let bookData = JSON.parse(body)
        res.render('detail', {
            book: bookData,
            error: null
        })
    })
})
app.listen(3000, ()=> {
    console.log('Server is working!')
})
