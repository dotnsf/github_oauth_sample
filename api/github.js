//. github.js
var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    request = require( 'request' ),
    session = require( 'express-session' ),
    router = express();

var settings = require( '../settings' );

router.use( bodyParser.urlencoded( { extended: true, limit: '10mb' } ) );
router.use( bodyParser.json() );

router.use( session({
  secret: 'githubapi',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,           //. https で使う場合は true
    maxage: 1000 * 60 * 60   //. 60min
  }
}));


router.get( '/login', function( req, res ){
  //. GitHub API V3
  //. https://docs.github.com/en/developers/apps/authorizing-oauth-apps
  res.redirect( 'https://github.com/login/oauth/authorize?client_id=' + settings.client_id + '&redirect_uri=' + settings.callback_url + '&scope=repo' );
});

router.post( '/logout', function( req, res ){
  if( req.session.oauth ){
    req.session.oauth = {};
  }
  res.contentType( 'application/json; charset=utf-8' );
  res.write( JSON.stringify( { status: true }, null, 2 ) );
  res.end();
});


router.get( '/callback', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var code = req.query.code;
  var option = {
    url: 'https://github.com/login/oauth/access_token',
    form: { client_id: settings.client_id, client_secret: settings.client_secret, code: code, redirect_uri: settings.callback_url },
    method: 'POST'
  };
  request( option, async function( err, res0, body ){
    if( err ){
      console.log( { err } );
    }else{
      //. body = 'access_token=XXXXX&scope=YYYY&token_type=ZZZZ';
      var tmp1 = body.split( '&' );
      for( var i = 0; i < tmp1.length; i ++ ){
        var tmp2 = tmp1[i].split( '=' );
        if( tmp2.length == 2 && tmp2[0] == 'access_token' ){
          var access_token = tmp2[1];

          req.session.oauth = {};
          req.session.oauth.token = access_token;

          var r = await GetMyInfo( access_token );
          if( r ){
            req.session.oauth.id = r.id;
            req.session.oauth.login = r.login;
            req.session.oauth.name = r.name;
            req.session.oauth.email = r.email;
            req.session.oauth.avatar_url = r.avatar_url;
          }
        }
      }
    }
    //console.log( 'redirecting...' );
    res.redirect( '/' );
  });
});

router.get( '/files', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  if( req.session && req.session.oauth && req.session.oauth.token ){
    var r = await ListFiles( req.session.oauth.token );
    console.log( { r } );
    res.write( JSON.stringify( r, null, 2 ) );
    res.end();
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { error: 'no access_token' }, null, 2 ) );
    res.end();
  }
});


router.get( '/isLoggedIn', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );
  var status = false;
  if( req.session && req.session.oauth && req.session.oauth.token ){
    status = JSON.parse( JSON.stringify( ( req.session.oauth ) ) );
  }

  if( !status ){
    res.status( 400 );
    res.write( JSON.stringify( { status: false }, null, 2 ) );
  }else{
    res.write( JSON.stringify( { status: true, user: status }, null, 2 ) );
  }
  res.end();
});


async function GetMyInfo( access_token ){
  return new Promise( async function( resolve, reject ){
    if( access_token ){
      var option = {
        url: 'https://api.github.com/user',
        headers: { 'Authorization': 'token ' + access_token, 'User-Agent': 'githubapi' },
        method: 'GET'
      };
      request( option, async function( err, res0, body ){
        if( err ){
          console.log( { err } );
          resolve( false );
        }else{
          body = JSON.parse( body );
          //. body = { login: 'dotnsf', id: XXXXXX, avatar_url: 'xxx', name: 'きむらけい', email: 'xxx@xxx', created_at: 'XX', updated_at: 'XX', ... }

          resolve( body );
        }
      });
    }else{
      resolve( false );
    }
  });
}

//. 現在のファイル一覧
async function ListFiles( access_token ){
  return new Promise( async function( resolve, reject ){
    if( access_token ){
      //. main ブランチの SHA 取得
      var option1 = {
        url: 'https://api.github.com/repos/' + settings.repo_name + '/git/refs/heads/main',
        headers: { 'Authorization': 'token ' + access_token, 'User-Agent': 'githubapi' },
        method: 'GET'
      };
      console.log( { option1 } );
      request( option1, async function( err1, res1, body1 ){
        if( err1 ){
          console.log( { err1 } );
          resolve( false );
        }else{
          body1 = JSON.parse( body1 );
          console.log( { body1 } );  //. body1 = { message: 'Git Repository is empty.', documentation_url 'xxx' }  ->  あらかじめリポジトリの main ブランチに README.md などを登録しておくことで回避
          var sha1 = body1.object.sha;

          //. インスペクト
          var option2 = {
            url: 'https://api.github.com/repos/' + settings.repo_name + '/commits/' + sha1,
            headers: { 'Authorization': 'token ' + access_token, 'User-Agent': 'githubapi' },
            method: 'GET'
          };
          request( option2, async function( err2, res2, body2 ){
            if( err2 ){
              console.log( { err2 } );
              resolve( false );
            }else{
              body2 = JSON.parse( body2 );  //. body2 = { commit: {}, url: '', author: {}, files: [], .. }
              console.log( { body2 } );

              //. tree
              var option3 = {
                url: 'https://api.github.com/repos/' + settings.repo_name + '/git/trees/' + body2.sha,
                headers: { 'Authorization': 'token ' + access_token, 'User-Agent': 'githubapi' },
                method: 'GET'
              };
              request( option3, async function( err3, res3, body3 ){
                if( err3 ){
                  console.log( { err3 } );
                  resolve( false );
                }else{
                  body3 = JSON.parse( body3 );
                  console.log( { body3 } ); //. body3.tree = [ { path: "README.md", size: 130, url: "", .. }, .. ]
    
                  resolve( body3.tree );
                }
              });
            }
          });
        }
      });
    }else{
      resolve( false );
    }
  });
}



//. router をエクスポート
module.exports = router;
